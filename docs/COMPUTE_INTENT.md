# Compute intent

An intent combines a validated ComputeJobSpecV1 with an integer-string maximum spend and a chain deadline. The canonical SHA-256 hash binds the workload. The buyer signs an atomic create-and-fund transaction, after which the job is OPEN for bids. The API retains a per-user specification row without placing code, input data, or secrets on-chain.

`POST /v1/quotes` performs non-binding discovery. `POST /v1/jobs` returns a serialized unsigned transaction and blockhash validity bounds. The browser's Sign & fund button asks the wallet to sign and send it, then checks confirmation. Creating a saved spec does not open a market or move tokens.

Job-spec access is offered to active registered workers for open auctions and the assigned worker after matching. Inputs currently must be empty for executable worker jobs. Do not embed credentials or private datasets in command strings.
