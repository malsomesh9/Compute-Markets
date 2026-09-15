import urllib.request,json,concurrent.futures,pathlib,subprocess
repos='nosana-ci/nosana-programs nosana-ci/nosana-kit nosana-ci/nosana-node nosana-ci/nosana-cli nosana-ci/indexer nosana-ci/nosana-deployment-manager akash-network/provider akash-network/node PrimeIntellect-ai/protocol PrimeIntellect-ai/prime PrimeIntellect-ai/prime-diloco bacalhau-project/bacalhau ray-project/ray ray-project/kuberay NVIDIA/nvidia-container-toolkit NVIDIA/dcgm-exporter vllm-project/vllm containerd/containerd opencontainers/runtime-spec google/gvisor firecracker-microvm/firecracker open-policy-agent/opa valkey-io/valkey open-telemetry/opentelemetry-js libp2p/rust-libp2p anza-xyz/kit solana-foundation/anchor fluencelabs/nox minio/minio'.split()
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'Vericompute-research'})
 return json.loads(subprocess.check_output(['curl','-fsSL','--max-time','40',url]))
def inspect(repo):
 try:
  meta=get('https://api.github.com/repos/'+repo); sha=get('https://api.github.com/repos/'+repo+'/commits/'+meta['default_branch'])['sha']; tree=get('https://api.github.com/repos/'+repo+'/git/trees/'+sha+'?recursive=1')['tree']
  paths=[x['path'] for x in tree if x['type']=='blob']; selected=[p for p in paths if p.lower() in ['readme.md','license','license.md','license.txt']]; selected += [p for p in paths if any(k in p.lower() for k in ['bidengine','reconcil','backfill','state/job','state/market','executor/interface','worker/src']) and p.endswith(('.rs','.ts','.go'))][:3]
  folder=pathlib.Path('research/upstream')/repo; folder.mkdir(parents=True,exist_ok=True)
  for p in selected:
   try:
    data=subprocess.check_output(['curl','-fsSL','--max-time','30','https://raw.githubusercontent.com/'+repo+'/'+sha+'/'+p]); (folder/p.replace('/','__')).write_bytes(data)
   except Exception: pass
  row={'repository':repo,'sha':sha,'license':(meta.get('license') or {}).get('spdx_id','unknown'),'archived':meta['archived'],'pushed_at':meta['pushed_at'],'inspected_files':selected,'directories':sorted(set(p.split('/')[0] for p in paths))}; (folder/'metadata.json').write_text(json.dumps(row,indent=2)); return row
 except Exception as e:return {'repository':repo,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: rows=list(pool.map(inspect,repos))
pathlib.Path('research/inventory.json').write_text(json.dumps(rows,indent=2)); print(json.dumps(rows,indent=2))
