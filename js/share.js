// Backend-free trace sharing: the dump(s) are gzip-compressed and base64url
// encoded into the URL #fragment (which never reaches a server, so any host /
// GitHub Pages is fine with the size). Opening such a link decodes and renders.
export async function encodeShare(payload) {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream === 'undefined') {
        return 'r' + b64urlEncode(bytes); // raw, uncompressed fallback
    }
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return 'g' + b64urlEncode(new Uint8Array(buf));
}
export async function decodeShare(token) {
    const marker = token[0];
    const bytes = b64urlDecode(token.slice(1));
    let json;
    if (marker === 'g') {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('This browser cannot decompress the shared link.');
        }
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const buf = await new Response(ds.readable).arrayBuffer();
        json = new TextDecoder().decode(new Uint8Array(buf));
    }
    else {
        json = new TextDecoder().decode(bytes);
    }
    return JSON.parse(json);
}
function b64urlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++)
        bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
    let b = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4)
        b += '=';
    const bin = atob(b);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
//# sourceMappingURL=share.js.map