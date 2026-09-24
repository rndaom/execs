"""Loopback-only product transport probe; requires Python cryptography.

The fixture exercises net::send_get through fake HTTP/HTTPS proxies and a
loopback TLS origin. No public network connection occurs.
"""

from __future__ import annotations

import base64
import datetime as dt
import ipaddress
import os
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


HOST = "api.github.com"
AUTH = "Basic " + base64.b64encode(b"tester:pass").decode("ascii")
CURL = shutil.which("curl.exe") or shutil.which("curl")
if CURL is None:
    raise RuntimeError("curl is required for this local fixture")
CURL_VERSION = subprocess.check_output([CURL, "--version"], text=True).splitlines()[0]
CUSTOM_CLIENT = os.environ.get("D8_CLIENT_BINARY")
PRODUCT_TEST = True
MANIFEST = Path(__file__).resolve().parents[1] / "apps/desktop/src-tauri/Cargo.toml"


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
    names = [HOST, "wrong.example"]
    if PRODUCT_TEST:
        names.extend(["github.com", "objects.githubusercontent.com", "localhost"])
    for name in names:
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


def read_exact(conn: socket.socket, count: int) -> bytes:
    data = bytearray()
    while len(data) < count:
        chunk = conn.recv(count - len(data))
        if not chunk:
            raise AssertionError("incomplete proxy handshake")
        data.extend(chunk)
    return bytes(data)


def probe(
    target: str, leaf: tuple[Path, Path], root: Path, case: str = "valid"
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
                            if case == "oversize_declared":
                                response = (
                                    b"HTTP/1.1 200 OK\r\nContent-Length: 1025\r\n"
                                    b"Connection: close\r\n\r\n" + b"x" * 1025
                                )
                            elif case == "oversize_streamed":
                                response = (
                                    b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n"
                                    b"Connection: close\r\n\r\n401\r\n"
                                    + b"x" * 1025 + b"\r\n0\r\n\r\n"
                                )
                            else:
                                response = (
                                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n"
                                    b"Connection: close\r\n\r\nok"
                                )
                            secure.sendall(response)
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
    if PRODUCT_TEST:
        environ.update(
            D8_PROXY=proxy,
            D8_TARGET=target,
            D8_CA=str(root),
            D8_CASE=case,
        )
        if case == "env_proxy":
            environ["HTTPS_PROXY"] = proxy
            environ["ALL_PROXY"] = "socks5h://127.0.0.1:9"
        command = [
            "cargo",
            "test",
            "--manifest-path",
            str(MANIFEST),
            "--lib",
            "net::tests::curl_product_tls_fixture",
            "--",
            "--ignored",
            "--exact",
            "--nocapture",
        ]
    elif CUSTOM_CLIENT:
        command = [CUSTOM_CLIENT, proxy, target, str(root)]
    else:
        command = [
            CURL,
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
        if "Schannel" in CURL_VERSION:
            command.insert(1, "--ssl-no-revoke")
    completed = subprocess.run(command, capture_output=True, text=True, env=environ, timeout=8)
    worker.join(timeout=7)
    result.update(exit_code=completed.returncode, stdout=completed.stdout, stderr=completed.stderr)
    if worker.is_alive() or "server_error" in result:
        raise AssertionError(result)
    return result


def product_redirect_probe(
    leaves: dict[str, tuple[Path, Path]], root: Path, blocked: bool
) -> dict[str, object]:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(2)
    listener.settimeout(5)
    result: dict[str, object] = {"connects": [], "snis": [], "hosts": [], "auth": []}
    names = ["github.com"] if blocked else ["github.com", "objects.githubusercontent.com"]

    def serve() -> None:
        try:
            with listener:
                for index, name in enumerate(names):
                    conn, _ = listener.accept()
                    with conn:
                        conn.settimeout(5)
                        headers = read_headers(conn).decode("ascii")
                        result["connects"].append(headers.split("\r\n", 1)[0])
                        result["auth"].append(f"Proxy-Authorization: {AUTH}\r\n" in headers)
                        conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
                        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                        context.load_cert_chain(
                            str(leaves[name][0]), str(leaves[name][1])
                        )
                        context.set_servername_callback(
                            lambda _socket, sni, _context: result["snis"].append(sni)
                        )
                        with context.wrap_socket(conn, server_side=True) as secure:
                            request = read_headers(secure).decode("ascii")
                            result["hosts"].append(f"Host: {name}\r\n" in request)
                            if index == 0:
                                location = (
                                    "https://evil.test/a"
                                    if blocked
                                    else "https://objects.githubusercontent.com/a"
                                )
                                response = (
                                    "HTTP/1.1 302 Found\r\n"
                                    f"Location: {location}\r\n"
                                    "Content-Length: 0\r\nConnection: close\r\n\r\n"
                                ).encode("ascii")
                            else:
                                response = (
                                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n"
                                    b"Connection: close\r\n\r\nok"
                                )
                            secure.sendall(response)
        except Exception as error:
            result["server_error"] = repr(error)

    worker = threading.Thread(target=serve)
    worker.start()
    port = listener.getsockname()[1]
    environ = {
        key: value
        for key, value in os.environ.items()
        if key.lower() not in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    }
    environ.update(
        D8_PROXY=f"http://tester:pass@127.0.0.1:{port}",
        D8_TARGET="1.1.1.1",
        D8_CA=str(root),
        D8_CASE="blocked_redirect" if blocked else "redirect",
    )
    completed = subprocess.run(
        [
            "cargo", "test", "--manifest-path", str(MANIFEST), "--lib",
            "net::tests::curl_product_tls_fixture", "--", "--ignored", "--exact",
            "--nocapture",
        ],
        capture_output=True, text=True, env=environ, timeout=8,
    )
    worker.join(timeout=7)
    result.update(exit_code=completed.returncode, stdout=completed.stdout, stderr=completed.stderr)
    if worker.is_alive() or "server_error" in result:
        raise AssertionError(result)
    return result


def product_no_proxy_probe(leaf: tuple[Path, Path], root: Path) -> dict[str, object]:
    direct = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    direct.bind(("127.0.0.1", 0))
    direct.listen(1)
    direct.settimeout(5)
    proxy = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    proxy.bind(("127.0.0.1", 0))
    proxy.listen(1)
    proxy.setblocking(False)
    port = direct.getsockname()[1]
    result: dict[str, object] = {}

    def serve() -> None:
        try:
            with direct:
                conn, _ = direct.accept()
                with conn:
                    conn.settimeout(5)
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(str(leaf[0]), str(leaf[1]))
                    context.set_servername_callback(
                        lambda _socket, name, _context: result.update(sni=name)
                    )
                    with context.wrap_socket(conn, server_side=True) as secure:
                        request = read_headers(secure).decode("ascii")
                        result["host"] = f"Host: api.github.com:{port}\r\n" in request
                        secure.sendall(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n"
                            b"Connection: close\r\n\r\nok"
                        )
        except Exception as error:
            result["server_error"] = repr(error)

    worker = threading.Thread(target=serve)
    worker.start()
    environ = {
        key: value
        for key, value in os.environ.items()
        if key.lower() not in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    }
    environ.update(
        D8_PROXY=f"http://tester:pass@127.0.0.1:{proxy.getsockname()[1]}",
        D8_TARGET=f"127.0.0.1:{port}",
        D8_CA=str(root),
        D8_CASE="no_proxy",
        NO_PROXY="api.github.com",
        HTTPS_PROXY=f"socks5h://127.0.0.1:{proxy.getsockname()[1]}",
    )
    completed = subprocess.run(
        [
            "cargo", "test", "--manifest-path", str(MANIFEST), "--lib",
            "net::tests::curl_product_tls_fixture", "--", "--ignored", "--exact",
            "--nocapture",
        ],
        capture_output=True, text=True, env=environ, timeout=8,
    )
    worker.join(timeout=7)
    result.update(exit_code=completed.returncode, stdout=completed.stdout, stderr=completed.stderr)
    try:
        unexpected, _ = proxy.accept()
        unexpected.close()
        result["proxy_contacted"] = True
    except BlockingIOError:
        result["proxy_contacted"] = False
    proxy.close()
    if worker.is_alive() or "server_error" in result:
        raise AssertionError(result)
    return result


def product_https_proxy_probe(
    leaf: tuple[Path, Path], root: Path, bad_cert: bool
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
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(str(leaf[0]), str(leaf[1]))
                    context.set_servername_callback(
                        lambda _socket, name, _context: result.update(proxy_sni=name)
                    )
                    try:
                        with context.wrap_socket(conn, server_side=True) as secure:
                            try:
                                request = read_headers(secure).decode("ascii")
                            except (AssertionError, ssl.SSLError):
                                result["connect_absent"] = True
                                return
                            result["connect"] = request.split("\r\n", 1)[0]
                            result["auth"] = f"Proxy-Authorization: {AUTH}\r\n" in request
                            secure.sendall(
                                b"HTTP/1.1 407 Proxy Authentication Required\r\n"
                                b"Proxy-Authenticate: Basic realm=\"test\"\r\n"
                                b"Content-Length: 0\r\nConnection: close\r\n\r\n"
                            )
                    except ssl.SSLError as error:
                        result["tls_error"] = error.reason
        except Exception as error:
            result["server_error"] = repr(error)

    worker = threading.Thread(target=serve)
    worker.start()
    port = listener.getsockname()[1]
    environ = {
        key: value
        for key, value in os.environ.items()
        if key.lower() not in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    }
    environ.update(
        D8_PROXY=f"https://tester:pass@localhost:{port}",
        D8_TARGET="1.1.1.1",
        D8_CA=str(root),
        D8_CASE="https_proxy_bad_cert" if bad_cert else "https_proxy_407",
    )
    completed = subprocess.run(
        [
            "cargo", "test", "--manifest-path", str(MANIFEST), "--lib",
            "net::tests::curl_product_tls_fixture", "--", "--ignored", "--exact",
            "--nocapture",
        ],
        capture_output=True, text=True, env=environ, timeout=8,
    )
    worker.join(timeout=7)
    result.update(exit_code=completed.returncode, stdout=completed.stdout, stderr=completed.stderr)
    if worker.is_alive() or "server_error" in result:
        raise AssertionError(result)
    return result


def product_https_proxy_success_probe(
    leaves: dict[str, tuple[Path, Path]], root: Path
) -> dict[str, object]:
    origin = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    origin.bind(("127.0.0.1", 0))
    origin.listen(1)
    origin.settimeout(5)
    proxy = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    proxy.bind(("127.0.0.1", 0))
    proxy.listen(1)
    proxy.settimeout(5)
    result: dict[str, object] = {}

    def serve_origin() -> None:
        try:
            with origin:
                conn, _ = origin.accept()
                with conn:
                    conn.settimeout(5)
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(
                        str(leaves[HOST][0]), str(leaves[HOST][1])
                    )
                    context.set_servername_callback(
                        lambda _socket, name, _context: result.update(origin_sni=name)
                    )
                    with context.wrap_socket(conn, server_side=True) as secure:
                        request = read_headers(secure).decode("ascii")
                        result["origin_host"] = f"Host: {HOST}\r\n" in request
                        secure.sendall(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n"
                            b"Connection: close\r\n\r\nok"
                        )
        except Exception as error:
            result["origin_error"] = repr(error)

    def serve_proxy() -> None:
        try:
            with proxy:
                conn, _ = proxy.accept()
                with conn:
                    conn.settimeout(5)
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(
                        str(leaves["localhost"][0]), str(leaves["localhost"][1])
                    )
                    context.set_servername_callback(
                        lambda _socket, name, _context: result.update(proxy_sni=name)
                    )
                    with context.wrap_socket(conn, server_side=True) as outer:
                        request = read_headers(outer).decode("ascii")
                        result["connect"] = request.split("\r\n", 1)[0]
                        result["auth"] = f"Proxy-Authorization: {AUTH}\r\n" in request
                        with socket.create_connection(
                            ("127.0.0.1", origin.getsockname()[1]), timeout=5
                        ) as upstream:
                            upstream.settimeout(5)
                            outer.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")

                            def upstream_to_outer() -> None:
                                try:
                                    while chunk := upstream.recv(8192):
                                        outer.sendall(chunk)
                                except OSError:
                                    pass

                            worker = threading.Thread(target=upstream_to_outer)
                            worker.start()
                            try:
                                while chunk := outer.recv(8192):
                                    upstream.sendall(chunk)
                            except OSError:
                                pass
                            worker.join(timeout=5)
                            if worker.is_alive():
                                result["relay_stuck"] = True
        except Exception as error:
            result["proxy_error"] = repr(error)

    origin_worker = threading.Thread(target=serve_origin)
    proxy_worker = threading.Thread(target=serve_proxy)
    origin_worker.start()
    proxy_worker.start()
    environ = {
        key: value
        for key, value in os.environ.items()
        if key.lower() not in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    }
    environ.update(
        D8_PROXY=f"https://tester:pass@localhost:{proxy.getsockname()[1]}",
        D8_TARGET="1.1.1.1",
        D8_CA=str(root),
        D8_CASE="valid",
    )
    completed = subprocess.run(
        [
            "cargo", "test", "--manifest-path", str(MANIFEST), "--lib",
            "net::tests::curl_product_tls_fixture", "--", "--ignored", "--exact",
            "--nocapture",
        ],
        capture_output=True, text=True, env=environ, timeout=8,
    )
    origin_worker.join(timeout=7)
    proxy_worker.join(timeout=7)
    result.update(exit_code=completed.returncode, stdout=completed.stdout, stderr=completed.stderr)
    if origin_worker.is_alive() or proxy_worker.is_alive():
        raise AssertionError(result)
    return result


def product_reuse_probe(leaf: tuple[Path, Path], root: Path) -> dict[str, object]:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(2)
    listener.settimeout(5)
    result: dict[str, object] = {"hosts": []}

    def serve() -> None:
        try:
            with listener:
                conn, _ = listener.accept()
                with conn:
                    conn.settimeout(5)
                    request = read_headers(conn).decode("ascii")
                    result["connect"] = request.split("\r\n", 1)[0]
                    result["auth"] = f"Proxy-Authorization: {AUTH}\r\n" in request
                    conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(str(leaf[0]), str(leaf[1]))
                    context.set_servername_callback(
                        lambda _socket, name, _context: result.update(sni=name)
                    )
                    with context.wrap_socket(conn, server_side=True) as secure:
                        for index in range(2):
                            request = read_headers(secure).decode("ascii")
                            result["hosts"].append(f"Host: {HOST}\r\n" in request)
                            connection = b"keep-alive" if index == 0 else b"close"
                            secure.sendall(
                                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: "
                                + connection + b"\r\n\r\nok"
                            )
        except Exception as error:
            result["server_error"] = repr(error)

    worker = threading.Thread(target=serve)
    worker.start()
    port = listener.getsockname()[1]
    environ = {
        key: value
        for key, value in os.environ.items()
        if key.lower() not in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    }
    environ.update(
        D8_PROXY=f"http://tester:pass@127.0.0.1:{port}",
        D8_TARGET="1.1.1.1",
        D8_CA=str(root),
        D8_CASE="reuse",
    )
    completed = subprocess.run(
        [
            "cargo", "test", "--manifest-path", str(MANIFEST), "--lib",
            "net::tests::curl_product_tls_fixture", "--", "--ignored", "--exact",
            "--nocapture",
        ],
        capture_output=True, text=True, env=environ, timeout=8,
    )
    worker.join(timeout=7)
    result.update(exit_code=completed.returncode, stdout=completed.stdout, stderr=completed.stderr)
    if worker.is_alive() or "server_error" in result:
        raise AssertionError(result)
    return result


def product_socks_probe(
    target: str, leaf: tuple[Path, Path], root: Path
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
                    version, methods_count = read_exact(conn, 2)
                    methods = read_exact(conn, methods_count)
                    assert version == 5 and 0 in methods
                    conn.sendall(b"\x05\x00")
                    version, command, reserved, address_type = read_exact(conn, 4)
                    assert (version, command, reserved) == (5, 1, 0)
                    if address_type == 1:
                        address = str(ipaddress.ip_address(read_exact(conn, 4)))
                    elif address_type == 4:
                        address = socket.inet_ntop(socket.AF_INET6, read_exact(conn, 16))
                    elif address_type == 3:
                        length = read_exact(conn, 1)[0]
                        address = read_exact(conn, length).decode("ascii")
                    else:
                        raise AssertionError(f"unexpected SOCKS address type {address_type}")
                    port = int.from_bytes(read_exact(conn, 2), "big")
                    result["address_type"] = address_type
                    result["target"] = address
                    result["port"] = port
                    conn.sendall(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00")
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(str(leaf[0]), str(leaf[1]))
                    context.set_servername_callback(
                        lambda _socket, name, _context: result.update(sni=name)
                    )
                    with context.wrap_socket(conn, server_side=True) as secure:
                        request = read_headers(secure).decode("ascii")
                        result["host"] = f"Host: {HOST}\r\n" in request
                        secure.sendall(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n"
                            b"Connection: close\r\n\r\nok"
                        )
        except Exception as error:
            result["server_error"] = repr(error)

    worker = threading.Thread(target=serve)
    worker.start()
    port = listener.getsockname()[1]
    environ = {
        key: value
        for key, value in os.environ.items()
        if key.lower() not in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    }
    proxy = f"socks5h://127.0.0.1:{port}"
    environ.update(
        D8_PROXY=proxy,
        D8_TARGET=target,
        D8_CA=str(root),
        D8_CASE="socks5h",
        HTTPS_PROXY=proxy,
    )
    completed = subprocess.run(
        [
            "cargo", "test", "--manifest-path", str(MANIFEST), "--lib",
            "net::tests::curl_product_tls_fixture", "--", "--ignored", "--exact",
            "--nocapture",
        ],
        capture_output=True, text=True, env=environ, timeout=8,
    )
    worker.join(timeout=7)
    result.update(exit_code=completed.returncode, stdout=completed.stdout, stderr=completed.stderr)
    if worker.is_alive() or "server_error" in result:
        raise AssertionError(result)
    return result


def main() -> None:
    print(f"Transport: {CURL_VERSION}")
    if PRODUCT_TEST:
        subprocess.run(
            ["cargo", "test", "--manifest-path", str(MANIFEST), "--lib", "--no-run"],
            check=True,
            capture_output=True,
            timeout=120,
        )
    with tempfile.TemporaryDirectory(prefix="d8-curl-probe-") as scratch:
        root, leaves = certificates(Path(scratch))
        ipv4 = probe("1.1.1.1", leaves[HOST], root)
        ipv6 = probe("[2606:4700:4700::1111]", leaves[HOST], root)
        mismatch = probe("1.1.1.1", leaves["wrong.example"], root, case="bad_cert")
        if PRODUCT_TEST:
            declared = probe("1.1.1.1", leaves[HOST], root, case="oversize_declared")
            streamed = probe("1.1.1.1", leaves[HOST], root, case="oversize_streamed")
            env_proxy = probe("1.1.1.1", leaves[HOST], root, case="env_proxy")
            redirected = product_redirect_probe(leaves, root, blocked=False)
            blocked_redirect = product_redirect_probe(leaves, root, blocked=True)
            no_proxy = product_no_proxy_probe(leaves[HOST], root)
            bad_proxy_cert = product_https_proxy_probe(leaves["wrong.example"], root, bad_cert=True)
            bad_proxy_auth = product_https_proxy_probe(leaves["localhost"], root, bad_cert=False)
            secure_proxy = product_https_proxy_success_probe(leaves, root)
            reused = product_reuse_probe(leaves[HOST], root)
            socks_ipv4 = product_socks_probe("1.1.1.1", leaves[HOST], root)
            socks_ipv6 = product_socks_probe("[2606:4700:4700::1111]", leaves[HOST], root)
    for label, observed, authority in [
        ("IPv4", ipv4, "CONNECT 1.1.1.1:443 HTTP/1.1"),
        ("IPv6", ipv6, "CONNECT [2606:4700:4700::1111]:443 HTTP/1.1"),
    ]:
        assert observed["connect"] == authority, (label, observed)
        assert observed["auth"] is True, (label, observed)
        assert observed["sni"] == HOST, (label, observed)
        assert observed["host"] is True, (label, observed)
        if PRODUCT_TEST:
            assert observed["exit_code"] == 0 and "test result: ok" in str(observed["stdout"]), (label, observed)
        else:
            assert observed["exit_code"] == 0 and observed["stdout"] == "ok", (label, observed)
        print(f"{label}: numeric CONNECT, Basic proxy auth, original SNI/Host, valid TLS: PASS")
    assert mismatch["connect"] == "CONNECT 1.1.1.1:443 HTTP/1.1", mismatch
    assert mismatch["sni"] == HOST, mismatch
    if PRODUCT_TEST:
        assert mismatch["exit_code"] == 0 and "CERT_REJECTED" in str(mismatch["stdout"]), mismatch
    else:
        assert mismatch["exit_code"] != 0, mismatch
        assert "certificate" in str(mismatch["stderr"]).lower(), mismatch
    print("Mismatched origin certificate rejected: PASS")
    if PRODUCT_TEST:
        for label, observed in [("Declared", declared), ("Streamed", streamed)]:
            assert observed["exit_code"] == 0 and "TOO_LARGE" in str(observed["stdout"]), (label, observed)
            print(f"{label} response beyond body cap rejected: PASS")
        assert env_proxy["exit_code"] == 0 and "test result: ok" in str(env_proxy["stdout"]), env_proxy
        assert env_proxy["connect"] == "CONNECT 1.1.1.1:443 HTTP/1.1" and env_proxy["auth"] is True, env_proxy
        print("HTTPS_PROXY environment selection sends numeric CONNECT: PASS")
        assert redirected["exit_code"] == 0 and "REDIRECT_OK" in str(redirected["stdout"]), redirected
        assert redirected["connects"] == ["CONNECT 1.1.1.1:443 HTTP/1.1"] * 2, redirected
        assert redirected["snis"] == ["github.com", "objects.githubusercontent.com"], redirected
        assert redirected["hosts"] == [True, True] and redirected["auth"] == [True, True], redirected
        print("Approved redirect rebinds numeric CONNECT and original TLS host: PASS")
        assert blocked_redirect["exit_code"] == 0 and "REDIRECT_BLOCKED" in str(blocked_redirect["stdout"]), blocked_redirect
        assert blocked_redirect["connects"] == ["CONNECT 1.1.1.1:443 HTTP/1.1"], blocked_redirect
        print("Untrusted redirect refused before another CONNECT: PASS")
        assert no_proxy["exit_code"] == 0 and "test result: ok" in str(no_proxy["stdout"]), no_proxy
        assert no_proxy["sni"] == HOST and no_proxy["host"] is True, no_proxy
        assert no_proxy["proxy_contacted"] is False, no_proxy
        print("NO_PROXY uses numeric direct destination and original TLS host: PASS")
        assert bad_proxy_cert["exit_code"] == 0 and "PROXY_CERT_REJECTED" in str(bad_proxy_cert["stdout"]), bad_proxy_cert
        assert bad_proxy_cert["proxy_sni"] == "localhost" and bad_proxy_cert.get("connect_absent") is True, bad_proxy_cert
        print("HTTPS proxy wrong-name certificate rejected before CONNECT: PASS")
        assert bad_proxy_auth["exit_code"] == 0 and "PROXY_AUTH_REJECTED" in str(bad_proxy_auth["stdout"]), bad_proxy_auth
        assert bad_proxy_auth["connect"] == "CONNECT 1.1.1.1:443 HTTP/1.1", bad_proxy_auth
        assert bad_proxy_auth["auth"] is True, bad_proxy_auth
        print("HTTPS proxy 407 authentication failure rejected: PASS")
        assert secure_proxy["exit_code"] == 0 and "test result: ok" in str(secure_proxy["stdout"]), secure_proxy
        assert secure_proxy["proxy_sni"] == "localhost" and secure_proxy["connect"] == "CONNECT 1.1.1.1:443 HTTP/1.1", secure_proxy
        assert secure_proxy["auth"] is True and secure_proxy["origin_sni"] == HOST and secure_proxy["origin_host"] is True, secure_proxy
        assert "origin_error" not in secure_proxy and "proxy_error" not in secure_proxy and "relay_stuck" not in secure_proxy, secure_proxy
        print("HTTPS proxy authenticated tunnel preserves origin TLS: PASS")
        assert reused["exit_code"] == 0 and "REUSED" in str(reused["stdout"]), reused
        assert reused["connect"] == "CONNECT 1.1.1.1:443 HTTP/1.1" and reused["auth"] is True, reused
        assert reused["sni"] == HOST and reused["hosts"] == [True, True], reused
        print("Same vetted origin reuses one authenticated TLS tunnel: PASS")
        for label, observed, expected_type, expected_target in [
            ("IPv4", socks_ipv4, 1, "1.1.1.1"),
            ("IPv6", socks_ipv6, 4, "2606:4700:4700::1111"),
        ]:
            assert observed["exit_code"] == 0 and "test result: ok" in str(observed["stdout"]), (label, observed)
            assert observed["address_type"] == expected_type and observed["target"] == expected_target and observed["port"] == 443, (label, observed)
            assert observed["sni"] == HOST and observed["host"] is True, (label, observed)
            print(f"SOCKS5h {label} receives vetted numeric target and original TLS host: PASS")


if __name__ == "__main__":
    main()
