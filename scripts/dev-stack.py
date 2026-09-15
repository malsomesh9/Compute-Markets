"""Start local development services without replacing processes already in use."""

import os
import pathlib
import socket
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATE = ROOT / ".insforge"
STATE.mkdir(exist_ok=True)
os.chdir(ROOT)

ENV = os.environ.copy()
ENV["PATH"] = (
    "/opt/homebrew/opt/node@24/bin"
    + ":"
    + str(pathlib.Path.home() / ".cargo/bin")
    + ":"
    + str(pathlib.Path.home() / ".local/share/solana/install/active_release/bin")
    + ":"
    + ENV["PATH"]
)


def occupied(port: int) -> bool:
    with socket.socket() as connection:
        return connection.connect_ex(("127.0.0.1", port)) == 0


def running(name: str) -> bool:
    pid_file = STATE / f"{name}.pid"
    if not pid_file.exists():
        return False
    try:
        os.kill(int(pid_file.read_text()), 0)
        return True
    except (ValueError, ProcessLookupError):
        return False


def start(name: str, command: list[str]) -> None:
    with (STATE / f"{name}.log").open("ab") as log:
        process = subprocess.Popen(
            command,
            env=ENV,
            stdout=log,
            stderr=log,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    (STATE / f"{name}.pid").write_text(str(process.pid))
    print(name, "started", process.pid)


services = [
    (
        "validator",
        8899,
        [
            "solana-test-validator",
            "--ledger",
            ".local-ledger",
            "--limit-ledger-size",
            "10000",
            "--rpc-port",
            "8899",
            "--bind-address",
            "127.0.0.1",
            "--quiet",
        ],
    ),
    (
        "api",
        4000,
        ["node", "--import", "tsx", "--env-file=.env.local", "apps/api/src/main.ts"],
    ),
    ("web", 3000, ["npm", "run", "dev", "-w", "apps/web"]),
]

for name, port, command in services:
    if occupied(port):
        print(name, "already listening on", port)
    else:
        start(name, command)

background = [
    (
        "indexer",
        ["node", "--import", "tsx", "--env-file=.env.local", "apps/indexer/src/main.ts"],
    ),
]
if (ROOT / "research/e2e-cpu-result.json").exists():
    background.append(
        (
            "fixture-heartbeats",
            [
                "node",
                "--import",
                "tsx",
                "--env-file=.env.local",
                "scripts/fixture-heartbeats.ts",
            ],
        )
    )

for name, command in background:
    if running(name):
        print(name, "already running")
    else:
        start(name, command)
