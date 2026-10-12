#!/bin/sh
# Publisher-pinned runtime preparation on the native Linux x64/macOS arm64 build host.
set -eu
destination=${1:?Supply a new absolute output directory}
case "$destination" in /*) ;; *) echo 'Output must be absolute.' >&2; exit 2;; esac
[ ! -e "$destination" ] || { echo 'Existing output will not be overwritten.' >&2; exit 2; }
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) node_archive=node-v22.23.3-linux-x64.tar.gz; node_hash=1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af;;
  Darwin/arm64) node_archive=node-v22.23.3-darwin-arm64.tar.gz; node_hash=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53;;
  *) echo 'Use a native Linux x64 or macOS Apple Silicon build host.' >&2; exit 2;;
esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
digest() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1; else shasum -a 256 "$1" | cut -d ' ' -f 1; fi; }
curl -fsSL --max-time 300 "https://nodejs.org/dist/v22.23.3/$node_archive" -o "$work/node.tar.gz"
[ "$(digest "$work/node.tar.gz")" = "$node_hash" ] || { echo 'Node archive checksum mismatch.' >&2; exit 1; }
curl -fsSL --max-time 300 https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.gz -o "$work/postgresql.tar.gz"
[ "$(digest "$work/postgresql.tar.gz")" = 4f200ca23dfb120ff9838f13ce06014aad1d3c432d16ee9f93ab2000c0eeef7b ] || { echo 'PostgreSQL source checksum mismatch.' >&2; exit 1; }
mkdir -p "$work/node" "$work/source" "$destination"
tar -xzf "$work/node.tar.gz" -C "$work/node" --strip-components=1
tar -xzf "$work/postgresql.tar.gz" -C "$work/source" --strip-components=1
cp "$work/node/bin/node" "$destination/node"
cp "$work/node/LICENSE" "$destination/NODE-LICENSE"
cd "$work/source"
# zlib is required for compatibility with existing compressed pg_dump archives.
./configure --prefix="$destination/postgresql" --without-readline --without-icu > "$work/build.log" 2>&1
make -j2 >> "$work/build.log" 2>&1 || { tail -n 30 "$work/build.log"; exit 1; }
make install >> "$work/build.log" 2>&1 || { tail -n 30 "$work/build.log"; exit 1; }
cp COPYRIGHT "$destination/POSTGRESQL-LICENSE"
echo 'Prepared pinned Node 22.23.3 and PostgreSQL 16.15 runtimes.'
