import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from "prom-client";
export const registry = new Registry();
collectDefaultMetrics({ register: registry });
export const requests = new Counter({
  name: "vericompute_http_requests_total",
  help: "HTTP responses",
  labelNames: ["route", "status"],
  registers: [registry],
});
export const latency = new Histogram({
  name: "vericompute_http_duration_seconds",
  help: "HTTP response duration",
  labelNames: ["route"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 15],
  registers: [registry],
});
