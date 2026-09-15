# MCP gateway

`npm run mcp` launches a stdio MCP server, configured with COMPUTE_API_URL, COMPUTE_ACCESS_TOKEN and COMPUTE_WALLET_PROOF. Keep tokens out of source control.

Tools: `compute_search`, `compute_quote`, `compute_run`, `compute_create_intent`, `compute_status`, `compute_logs`, `compute_result`, `compute_receipt`, `compute_verify`, `compute_market_price`, and `compute_cancel`. Agent tools are `compute_agent_policies`, `compute_agent_create_job`, `compute_agent_accept_bid`, and `compute_agent_cancel`. `compute_search` supports bounded cursor pagination.

Economic tools return unsigned transactions. A trusted signer must approve ordinary buyer transactions or sign as the configured agent. Agent transactions remain bounded by the owner's on-chain Merkle allowlist, daily/per-job/runtime/verification limits, expiry, and SPL-token delegation; the MCP server never receives the owner's private key.
