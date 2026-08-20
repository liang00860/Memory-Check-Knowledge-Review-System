import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";

const outputDirectory = join(process.cwd(), ".wrangler", "fixtures");
const outputPath = join(outputDirectory, "structured-red-questions.docx");

const files = {
  "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`),
  "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`),
  "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:r><w:t>1. 完整的计算机系统由______和______构成。</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>硬件系统</w:t></w:r>
          <w:r><w:t>、</w:t></w:r>
          <w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>软件系统</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>2. CPU 的中文名称是______。答案：</w:t></w:r>
          <w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>中央处理器</w:t></w:r>
        </w:p>
        <w:sectPr/>
      </w:body>
    </w:document>`),
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, zipSync(files));
console.log(outputPath);
