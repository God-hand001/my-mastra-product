// pdf-parse@1.1.1 未内置类型声明(且入口含调试逻辑,代码中直接引 lib/pdf-parse.js)
declare module 'pdf-parse/lib/pdf-parse.js' {
  function pdfParse(buffer: Buffer): Promise<{ text: string; numpages: number }>;
  export default pdfParse;
}
