fn main() {
    let cfg = review_sync::Config::from_env();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    runtime.block_on(async {
        if let Err(err) = review_sync::serve(cfg).await {
            eprintln!("[review] server error: {err}");
            std::process::exit(1);
        }
    });
}
