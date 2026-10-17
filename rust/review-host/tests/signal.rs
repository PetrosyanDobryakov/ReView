//! End-to-end: two sockets meet on a real host and swap a signal.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

async fn next_json<S>(ws: &mut S) -> Value
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        match ws.next().await.expect("socket open").expect("frame") {
            Message::Text(t) => return serde_json::from_str(&t).unwrap(),
            Message::Close(_) => panic!("closed"),
            _ => {}
        }
    }
}

#[tokio::test]
async fn peers_meet_and_signal() {
    let cfg = review_host::Config {
        host: "127.0.0.1".into(),
        port: 0,
        mdns: false,
        ..Default::default()
    };
    let host = review_host::start(cfg, None).await.unwrap();
    let base = format!("ws://127.0.0.1:{}/signal/review-test", host.port());

    let (mut a, _) = tokio_tungstenite::connect_async(format!("{base}?peer=peer-aaa"))
        .await
        .unwrap();
    assert_eq!(next_json(&mut a).await["peers"], json!([]));
    let (mut b, _) = tokio_tungstenite::connect_async(format!("{base}?peer=peer-bbb"))
        .await
        .unwrap();
    let welcome = next_json(&mut b).await;
    assert_eq!(welcome["t"], "welcome");
    assert_eq!(welcome["peers"], json!(["peer-aaa"]));
    assert_eq!(next_json(&mut a).await, json!({"t":"join","peer":"peer-bbb"}));

    b.send(Message::Text(
        json!({"t":"signal","to":"peer-aaa","data":{"kind":"offer","sdp":"x"}})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    assert_eq!(
        next_json(&mut a).await,
        json!({"t":"signal","from":"peer-bbb","data":{"kind":"offer","sdp":"x"}})
    );

    // Binary frames are refused: the hub never carries board data.
    b.send(Message::Binary(vec![1, 2, 3].into())).await.unwrap();
    assert_eq!(next_json(&mut a).await, json!({"t":"leave","peer":"peer-bbb"}));
    assert_eq!(host.stats().peers, 1);

    drop(a);
    for _ in 0..50 {
        if host.stats().rooms == 0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(host.stats().rooms, 0, "empty room must be forgotten");
}

#[tokio::test]
async fn rejects_bad_ids() {
    let cfg = review_host::Config {
        host: "127.0.0.1".into(),
        port: 0,
        mdns: false,
        ..Default::default()
    };
    let host = review_host::start(cfg, None).await.unwrap();
    let port = host.port();
    let bad = tokio_tungstenite::connect_async(format!(
        "ws://127.0.0.1:{port}/signal/review-x?peer=no"
    ))
    .await;
    assert!(bad.is_err());
    let bad_room = tokio_tungstenite::connect_async(format!(
        "ws://127.0.0.1:{port}/signal/a%2Fb?peer=peer-ok1"
    ))
    .await;
    assert!(bad_room.is_err());
}
