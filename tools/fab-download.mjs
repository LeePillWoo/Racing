// Downloads the .glb of a free Fab listing through a browser that is already signed in to fab.com.
//
// Start Chrome with a debugging port and sign in once:
//   chrome --remote-debugging-port=9333 --user-data-dir=<profile dir> https://www.fab.com/
// then:
//   node tools/fab-download.mjs <listing-uid> <out-dir>          add to library and download
//   node tools/fab-download.mjs <listing-uid> <out-dir> --list   only show the files on offer
//
// It refuses anything that is not free, and writes the title, author and licence next to the
// file as source.json. Check that licence before committing anything built from the download:
// this repository is public, so only assets that may be redistributed (CC BY) belong in it.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [uid, outDir, flag] = process.argv.slice(2);
const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
const page = targets.find(t => t.type === "page" && t.url.includes("fab.com"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let nextId = 0;
const pending = new Map();
ws.onmessage = event => { const m = JSON.parse(event.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const evaluate = async expression => {
  const reply = await new Promise(ok => {
    const id = ++nextId; pending.set(id, ok);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails.exception?.description));
  return reply.result.result.value;
};
const api = async (path, init = "{}") => JSON.parse(await evaluate(
  `fetch("https://www.fab.com${path}", Object.assign({ credentials: "include", headers: { accept: "application/json" } }, ${init}))` +
  `.then(async r => JSON.stringify({ status: r.status, body: await r.text() }))`));
const json = reply => { try { return JSON.parse(reply.body); } catch { return reply.body.slice(0, 300); } };

try {
  const listing = json(await api(`/i/listings/${uid}`));
  const license = listing.licenses.find(l => l.isCc) ?? listing.licenses[0];
  console.log("listing:", listing.title, "| by", listing.user?.sellerName, "| license", license.name, "| price", license.priceTier?.price);
  if (license.priceTier?.price !== 0) throw new Error("not free — refusing");
  const formats = json(await api(`/i/listings/${uid}/asset-formats`));
  const files = formats.flatMap(f => f.files.map(file => ({ ...file, format: f.assetFormatType.code })));
  for (const f of files) console.log("  ", f.format.padEnd(16), (f.fileSize / 1e6).toFixed(2).padStart(8), "MB ", f.name);
  if (flag === "--list") process.exit(0);

  const state = json(await api(`/i/users/me/listings-states/${uid}`));
  if (!state.acquired) {
    const added = await api(`/i/listings/${uid}/add-to-library`,
      `(() => { const body = new FormData(); body.append("offer_id", ${JSON.stringify(license.offerId)});
        const token = document.cookie.split("; ").find(c => c.startsWith("fab_csrftoken="))?.split("=")[1];
        return { method: "POST", body, headers: { accept: "application/json", "X-CsrfToken": token, "X-Requested-With": "XMLHttpRequest" } }; })()`);
    console.log("add-to-library:", added.status, added.body.slice(0, 200));
  } else console.log("already in library");

  const wanted = files.find(f => f.name.endsWith(".glb") && f.format !== "fbx")
    ?? files.find(f => /gltf.*\.zip$/i.test(f.name)) ?? files.find(f => f.format === "gltf" || f.format === "glb");
  if (!wanted) throw new Error("no glb/gltf file in this listing");
  const info = await api(`/i/listings/${uid}/asset-formats/${wanted.format}/files/${wanted.uid}/download-info`);
  const downloadUrl = json(info)?.downloadInfo?.[0]?.downloadUrl;
  if (!downloadUrl) throw new Error("download-info failed: " + info.status + " " + info.body.slice(0, 300));
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error("download failed: " + response.status);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, wanted.name);
  writeFileSync(out, Buffer.from(await response.arrayBuffer()));
  writeFileSync(join(outDir, "source.json"), JSON.stringify({
    uid, title: listing.title, author: listing.user?.sellerName, license: license.name,
    url: `https://www.fab.com/listings/${uid}`, file: wanted.name,
  }, null, 1));
  console.log("saved", out);
} catch (error) {
  console.log("FAILED:", error.message);
  process.exitCode = 1;
} finally { ws.close(); }
