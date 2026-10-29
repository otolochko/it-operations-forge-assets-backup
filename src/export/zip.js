import { Zip, ZipDeflate, strToU8 } from 'fflate';

// Files must be written one at a time: finish a file (end) before opening the next.
export function createZipWriter() {
  const chunks = [];
  let failure = null;
  let finished;
  const done = new Promise((resolve) => {
    finished = resolve;
  });
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failure = err;
      finished();
      return;
    }
    chunks.push(chunk);
    if (final) finished();
  });

  return {
    openFile(name) {
      const file = new ZipDeflate(name, { level: 6 });
      zip.add(file);
      return {
        write: (text) => file.push(strToU8(text)),
        end: () => file.push(new Uint8Array(0), true),
      };
    },
    addText(name, text) {
      const file = this.openFile(name);
      file.write(text);
      file.end();
    },
    async finish() {
      zip.end();
      await done;
      if (failure) throw failure;
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      return bytes;
    },
    abort() {
      zip.terminate();
      chunks.length = 0;
    },
  };
}
