use std::time::Duration;

use curl::easy::{Easy, List, SslOpt};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let proxy = args.next().ok_or("proxy URL required")?;
    let target = args.next().ok_or("target IP required")?;
    let ca = args.next().ok_or("CA file required")?;
    if args.next().is_some() {
        return Err("unexpected argument".into());
    }

    let mut easy = Easy::new();
    easy.url("https://example.com/")?;
    easy.proxy(&proxy)?;
    easy.noproxy("")?;
    easy.cainfo(&ca)?;
    easy.connect_timeout(Duration::from_secs(3))?;
    easy.timeout(Duration::from_secs(5))?;
    easy.follow_location(false)?;
    if cfg!(windows) {
        // The disposable test CA has no CRL endpoint. Product code must not
        // change Schannel's revocation policy on this basis.
        easy.ssl_options(SslOpt::new().no_revoke(true))?;
    }
    let mut destinations = List::new();
    destinations.append(&format!("example.com:443:{target}:443"))?;
    easy.connect_to(destinations)?;

    let mut body = Vec::new();
    {
        let mut transfer = easy.transfer();
        transfer.write_function(|chunk| {
            body.extend_from_slice(chunk);
            Ok(chunk.len())
        })?;
        transfer.perform()?;
    }
    if easy.response_code()? != 200 {
        return Err("unexpected response status".into());
    }
    print!("{}", String::from_utf8(body)?);
    Ok(())
}
