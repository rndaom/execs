"""Loopback-only libcurl CONNECT_TO probe; requires Python cryptography.

This is a transport feasibility fixture, not a product security test. The fake
proxy acknowledges CONNECT but does not dial its requested target; it serves a
short HTTPS response on the same socket. No public network connection occurs.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import os
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


HOST = "example.com"
AUTH = "Basic " + base64.b64encode(b"tester:pass").decode("ascii")


@dataclass(frozen=True)
class ProbeClient:
    binary: str
    rust: bool
    version: str


def certificates(directory: Path) -> tuple[Path, dict[str, tuple[Path, Path]]]:
    now = dt.datetime.now(dt.timezone.utc)
    root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    root_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "D8 local test root")])
    root = (
        x509.CertificateBuilder()
        .subject_name(root_name)
        .issuer_name(root_name)
        .public_key(root_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(root_key, hashes.SHA256())
    )
    root_path = directory / "root.pem"
    root_path.write_bytes(root.public_bytes(serialization.Encoding.PEM))
    leaves: dict[str, tuple[Path, Path]] = {}
    for name in [HOST, "wrong.example"]:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        leaf = (
            x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)]))
            .issuer_name(root_name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=1))
            .not_valid_after(now + dt.timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False)
            .add_extension(
                x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
            )
            .sign(root_key, hashes.SHA256())
        )
        cert_path = directory / f"{name}.pem"
        key_path = directory / f"{name}.key"
        cert_path.write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
        leaves[name] = (cert_path, key_path)
    return root_path, leaves


def read_headers(conn: socket.socket) -> bytes:
    data = bytearray()
    while not data.endswith(b"\r\n\r\n"):
        chunk = conn.recv(4096)
        if not chunk or len(data) + len(chunk) > 8192:
            raise AssertionError("incomplete or oversized request headers")
        data.extend(chunk)
    return bytes(data)


def probe(
    target: str, leaf: tuple[Path, Path], root: Path, client: ProbeClient
) -> dict[str, object]:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    listener.settimeout(5)
    result: dict[str, object] = {}

    def serve() -> None:
        try:
            with listener:
                conn, _ = listener.accept()
                with conn:
                    conn.settimeout(5)
                    headers = read_headers(conn).decode("ascii")
                    result["connect"] = headers.split("\r\n", 1)[0]
                    result["auth"] = f"Proxy-Authorization: {AUTH}\r\n" in headers
                    conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(str(leaf[0]), str(leaf[1]))
                    context.set_servername_callback(
                        lambda _socket, name, _context: result.update(sni=name)
                    )
                    try:
                        with context.wrap_socket(conn, server_side=True) as secure:
                            try:
                                request = read_headers(secure).decode("ascii")
                            except AssertionError:
                                # Expected when curl rejects the wrong-name
                                # certificate before sending an HTTP request.
                                result["origin_request_absent"] = True
                                return
                            result["host"] = f"Host: {HOST}\r\n" in request
                            secure.sendall(
                                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n"
                                b"Connection: close\r\n\r\nok"
                            )
                    except ssl.SSLError as error:
                        result["tls_error"] = error.reason
        except Exception as error:  # propagate worker failures to main thread
            result["server_error"] = repr(error)

    worker = threading.Thread(target=serve)
    worker.start()
    port = listener.getsockname()[1]
    environ = {
        key: value
        for key, value in os.environ.items()
        if key.lower() not in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    }
    proxy = f"http://tester:pass@127.0.0.1:{port}"
    if client.rust:
        command = [client.binary, proxy, target, str(root)]
    else:
        command = [
            client.binary,
            "--silent",
            "--show-error",
            "--connect-timeout",
            "3",
            "--max-time",
            "5",
            "--cacert",
            str(root),
            "--proxy",
            proxy,
            "--noproxy",
            "",
            "--connect-to",
            f"{HOST}:443:{target}:443",
            f"https://{HOST}/",
        ]
        if "Schannel" in client.version:
            # The ephemeral test CA has no CRL endpoint. This affects only
            # this fixture's revocation lookup, not product TLS settings.
            command.insert(1, "--ssl-no-revoke")
    completed = subprocess.run(command, capture_output=True, text=True, env=environ, timeout=8)
    worker.join(timeout=7)
    result.update(exit_code=completed.returncode, stdout=completed.stdout, stderr=completed.stderr)
    if worker.is_alive() or "server_error" in result:
        raise AssertionError(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rust-client", type=Path, help="audit-local Rust prototype binary"
    )
    args = parser.parse_args()
    if args.rust_client:
        binary = args.rust_client.resolve(strict=True)
        if not binary.is_file():
            parser.error("Rust client path must be a file")
        client = ProbeClient(str(binary), True, "Rust curl binding prototype")
    else:
        binary = shutil.which("curl.exe") or shutil.which("curl")
        if binary is None:
            parser.error("curl CLI is required without --rust-client")
        version = subprocess.check_output([binary, "--version"], text=True).splitlines()[0]
        client = ProbeClient(binary, False, version)
    print(f"Transport: {client.version}")
    with tempfile.TemporaryDirectory(prefix="d8-curl-probe-") as scratch:
        root, leaves = certificates(Path(scratch))
        ipv4 = probe("1.1.1.1", leaves[HOST], root, client)
        ipv6 = probe("[2606:4700:4700::1111]", leaves[HOST], root, client)
        mismatch = probe("1.1.1.1", leaves["wrong.example"], root, client)
    for label, observed, authority in [
        ("IPv4", ipv4, "CONNECT 1.1.1.1:443 HTTP/1.1"),
        ("IPv6", ipv6, "CONNECT [2606:4700:4700::1111]:443 HTTP/1.1"),
    ]:
        assert observed["connect"] == authority, (label, observed)
        assert observed["auth"] is True, (label, observed)
        assert observed["sni"] == HOST, (label, observed)
        assert observed["host"] is True, (label, observed)
        assert observed["exit_code"] == 0 and observed["stdout"] == "ok", (label, observed)
        print(f"{label}: numeric CONNECT, Basic proxy auth, original SNI/Host, valid TLS: PASS")
    assert mismatch["connect"] == "CONNECT 1.1.1.1:443 HTTP/1.1", mismatch
    assert mismatch["sni"] == HOST, mismatch
    assert mismatch.get("origin_request_absent") is True, mismatch
    if client.rust:
        assert mismatch["exit_code"] != 0, mismatch
    else:
        assert mismatch["exit_code"] == 60, mismatch
    assert "certificate" in str(mismatch["stderr"]).lower(), mismatch
    print("Mismatched origin certificate rejected: PASS")


if __name__ == "__main__":
    main()
