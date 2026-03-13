// Vercel Serverless — Alpaca Trading API Proxy
// 페이퍼 트레이딩 & 실거래 모두 지원
// /api/alpaca?action=account|positions|orders|submit_order|cancel_order|activities
// Headers: x-alpaca-key, x-alpaca-secret, x-alpaca-paper (true/false)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-alpaca-key, x-alpaca-secret, x-alpaca-paper");

  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = req.headers["x-alpaca-key"];
  const apiSecret = req.headers["x-alpaca-secret"];
  const isPaper = req.headers["x-alpaca-paper"] !== "false";

  if (!apiKey || !apiSecret) {
    return res.status(400).json({ error: "Missing API credentials. Provide x-alpaca-key and x-alpaca-secret headers." });
  }

  const baseUrl = isPaper
    ? "https://paper-api.alpaca.markets"
    : "https://api.alpaca.markets";
  const dataUrl = "https://data.alpaca.markets";

  const action = req.query.action || req.body?.action;
  const headers = {
    "APCA-API-KEY-ID": apiKey,
    "APCA-API-SECRET-KEY": apiSecret,
    "Content-Type": "application/json",
  };

  try {
    let result;

    switch (action) {
      // ── 계좌 정보 ──
      case "account": {
        const r = await fetch(`${baseUrl}/v2/account`, { headers });
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 포지션 조회 ──
      case "positions": {
        const r = await fetch(`${baseUrl}/v2/positions`, { headers });
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 특정 포지션 ──
      case "position": {
        const symbol = req.query.symbol;
        if (!symbol) return res.status(400).json({ error: "symbol required" });
        const r = await fetch(`${baseUrl}/v2/positions/${symbol}`, { headers });
        if (r.status === 404) { result = null; break; }
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 주문 목록 ──
      case "orders": {
        const status = req.query.status || "all";
        const limit = req.query.limit || "50";
        const r = await fetch(`${baseUrl}/v2/orders?status=${status}&limit=${limit}&direction=desc`, { headers });
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 주문 제출 ──
      case "submit_order": {
        const body = req.body || {};
        const orderPayload = {
          symbol: body.symbol,
          qty: body.qty ? String(body.qty) : undefined,
          notional: body.notional ? String(body.notional) : undefined,
          side: body.side || "buy",           // buy | sell
          type: body.type || "market",        // market | limit | stop | stop_limit
          time_in_force: body.time_in_force || "day", // day | gtc | ioc | fok
        };
        if (body.type === "limit" || body.type === "stop_limit") {
          orderPayload.limit_price = String(body.limit_price);
        }
        if (body.type === "stop" || body.type === "stop_limit") {
          orderPayload.stop_price = String(body.stop_price);
        }
        // 선택적 필드
        if (body.take_profit) orderPayload.take_profit = body.take_profit;
        if (body.stop_loss) orderPayload.stop_loss = body.stop_loss;
        if (body.client_order_id) orderPayload.client_order_id = body.client_order_id;

        const r = await fetch(`${baseUrl}/v2/orders`, {
          method: "POST",
          headers,
          body: JSON.stringify(orderPayload),
        });
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 주문 취소 ──
      case "cancel_order": {
        const orderId = req.query.order_id || req.body?.order_id;
        if (!orderId) return res.status(400).json({ error: "order_id required" });
        const r = await fetch(`${baseUrl}/v2/orders/${orderId}`, {
          method: "DELETE",
          headers,
        });
        if (r.status === 204) { result = { success: true }; break; }
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 전체 주문 취소 ──
      case "cancel_all": {
        const r = await fetch(`${baseUrl}/v2/orders`, {
          method: "DELETE",
          headers,
        });
        if (r.status === 207 || r.status === 200) {
          result = await r.json().catch(() => ({ success: true }));
        } else {
          result = await r.json();
          if (!r.ok) return res.status(r.status).json(result);
        }
        break;
      }

      // ── 전체 포지션 청산 ──
      case "close_all": {
        const r = await fetch(`${baseUrl}/v2/positions`, {
          method: "DELETE",
          headers,
        });
        result = await r.json().catch(() => ({ success: true }));
        break;
      }

      // ── 특정 포지션 청산 ──
      case "close_position": {
        const symbol = req.query.symbol || req.body?.symbol;
        if (!symbol) return res.status(400).json({ error: "symbol required" });
        const r = await fetch(`${baseUrl}/v2/positions/${symbol}`, {
          method: "DELETE",
          headers,
        });
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 거래 내역 ──
      case "activities": {
        const actType = req.query.activity_type || "FILL";
        const limit = req.query.limit || "50";
        const r = await fetch(`${baseUrl}/v2/account/activities/${actType}?limit=${limit}`, { headers });
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 최신 시세 (Alpaca Data API) ──
      case "latest_quote": {
        const symbol = req.query.symbol;
        if (!symbol) return res.status(400).json({ error: "symbol required" });
        const r = await fetch(`${dataUrl}/v2/stocks/${symbol}/quotes/latest`, { headers });
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      // ── 마켓 상태 확인 ──
      case "clock": {
        const r = await fetch(`${baseUrl}/v2/clock`, { headers });
        result = await r.json();
        if (!r.ok) return res.status(r.status).json(result);
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}. Supported: account, positions, orders, submit_order, cancel_order, cancel_all, close_all, close_position, activities, latest_quote, clock` });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  } catch (err) {
    console.error("[Alpaca Proxy Error]", err.message);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
