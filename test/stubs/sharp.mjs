// Stand-in for sharp: enough of its chain for the upload handler.
export default function sharp(input) {
  const chain = {
    metadata: async () => ({ width: 800, height: 600 }),
    rotate: () => chain,
    resize: () => chain,
    webp: () => chain,
    toBuffer: async () => Buffer.from(`webp:${input.length}`),
  };
  return chain;
}
