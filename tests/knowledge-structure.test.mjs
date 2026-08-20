import assert from "node:assert/strict";
import test from "node:test";

import {
  inferQuestionAnswerPairs,
  splitAnswerParts,
  tagLinesWithRedFragments,
} from "../app/lib/knowledge-structure.ts";
import {
  answerMeaningSimilarity,
  buildQuestions,
  gradeAnswer,
  isAnswerCorrect,
  isMeaningClose,
} from "../app/lib/study.ts";

test("pairs wrapped numbered questions with ordered multi-blank answers", () => {
  const pairs = inferQuestionAnswerPairs([
    { text: "章节标题" },
    { text: "1. 软件运行所需要的________、________和" },
    { text: "________共同构成完整资料。" },
    { text: "程序 数据 文档", redText: "程序 数据 文档" },
    { text: "2. 操作系统简称________。" },
    { text: "OS", redText: "OS" },
  ]);

  assert.equal(pairs.length, 2);
  assert.equal(
    pairs[0].question,
    "软件运行所需要的______、______和 ______共同构成完整资料。",
  );
  assert.deepEqual(pairs[0].answers, ["程序", "数据", "文档"]);
  assert.deepEqual(pairs[1].answers, ["OS"]);
});

test("removes a superscript footnote that splits one answer phrase", () => {
  assert.deepEqual(
    splitAnswerParts("只读存储器 只能 3 读取数据不能写入数据 不会", 3),
    ["只读存储器", "只能读取数据不能写入数据", "不会"],
  );
});

test("keeps slash alternatives inside one blank answer", () => {
  assert.deepEqual(
    splitAnswerParts("操作码 地址码/操作数", 2),
    ["操作码", "地址码/操作数"],
  );
});

test("splits Chinese list punctuation only when it matches the blank count", () => {
  assert.deepEqual(
    splitAnswerParts("中央处理器、内存储器", 2),
    ["中央处理器", "内存储器"],
  );
});

test("recognizes bracketed and unnumbered fill questions", () => {
  const pairs = inferQuestionAnswerPairs([
    { text: "（1）完整的计算机系统由______和______构成。" },
    { text: "硬件系统 软件系统", redText: "硬件系统 软件系统" },
    { text: "CPU 的中文名称是______。" },
    { text: "中央处理器", redText: "中央处理器" },
  ]);

  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].question, "完整的计算机系统由______和______构成。");
  assert.deepEqual(pairs[0].answers, ["硬件系统", "软件系统"]);
  assert.equal(pairs[1].question, "CPU 的中文名称是______。");
  assert.deepEqual(pairs[1].answers, ["中央处理器"]);
});

test("recognizes a red answer on the same line as its question", () => {
  const pairs = inferQuestionAnswerPairs([
    {
      text: "1. 用于连接总线和外部设备的是________。答案：接口",
      redText: "接口",
    },
  ]);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].question, "用于连接总线和外部设备的是______。");
  assert.deepEqual(pairs[0].answers, ["接口"]);
});

test("maps OCR red fragments back to their full answer line", () => {
  const lines = tagLinesWithRedFragments(
    [
      "1. 软件运行所需要的________、________和________。",
      "程序 数据 文档",
    ].join("\n"),
    ["程序", "数据", "文档"],
  );
  const pairs = inferQuestionAnswerPairs(lines);

  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].answers, ["程序", "数据", "文档"]);
});

test("pairs a question at the end of one PDF page with its red answer on the next page", () => {
  const pairs = inferQuestionAnswerPairs([
    {
      text: "1. CPU 由______和______组成。",
      location: "第 1 页",
    },
    {
      text: "运算器 控制器",
      redText: "运算器 控制器",
      location: "第 2 页",
    },
    {
      text: "2. 内存简称______。",
      location: "第 2 页",
    },
    {
      text: "RAM",
      redText: "RAM",
      location: "第 2 页",
    },
  ]);

  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0].answers, ["运算器", "控制器"]);
  assert.deepEqual(pairs[1].answers, ["RAM"]);
});

test("keeps a red explanation out of the red answer", () => {
  const pairs = inferQuestionAnswerPairs([
    { text: "1. CPU 的中文名称是______。" },
    { text: "中央处理器", redText: "中央处理器" },
    {
      text: "解析：CPU 是 Central Processing Unit 的缩写。",
      redText: "解析：CPU 是 Central Processing Unit 的缩写。",
    },
  ]);

  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].answers, ["中央处理器"]);
  assert.equal(
    pairs[0].explanation,
    "CPU 是 Central Processing Unit 的缩写。",
  );
  assert.deepEqual(pairs[0].usedRedLineIndexes, [1, 2]);
});

test("splits an answer and explanation that share one red line", () => {
  const pairs = inferQuestionAnswerPairs([
    { text: "1. CPU 的中文名称是______。" },
    {
      text: "答案：中央处理器 解析：CPU 是 Central Processing Unit 的缩写。",
      redText: "中央处理器 解析：CPU 是 Central Processing Unit 的缩写。",
    },
  ]);

  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].answers, ["中央处理器"]);
  assert.equal(
    pairs[0].explanation,
    "CPU 是 Central Processing Unit 的缩写。",
  );
});

test("supports bracketed and unspaced inline explanation labels", () => {
  const bracketed = inferQuestionAnswerPairs([
    { text: "1. CPU 的中文名称是______。" },
    {
      text: "答案：中央处理器 【解析】CPU 负责指令执行。",
      redText: "中央处理器 【解析】CPU 负责指令执行。",
    },
  ]);
  const unspaced = inferQuestionAnswerPairs([
    { text: "1. CPU 的中文名称是______。" },
    {
      text: "中央处理器解析：CPU 负责指令执行。",
      redText: "中央处理器解析：CPU 负责指令执行。",
    },
  ]);

  for (const pairs of [bracketed, unspaced]) {
    assert.deepEqual(pairs[0].answers, ["中央处理器"]);
    assert.equal(pairs[0].explanation, "CPU 负责指令执行。");
  }
});

test("ignores a red page header before a cross-page answer", () => {
  const pairs = inferQuestionAnswerPairs([
    {
      text: "1. CPU 的中文名称是______。",
      location: "第 1 页",
    },
    {
      text: "背诵清单 第 6 次",
      redText: "背诵清单 第 6 次",
      location: "第 2 页",
    },
    {
      text: "中央处理器",
      redText: "中央处理器",
      location: "第 2 页",
    },
  ]);

  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].answers, ["中央处理器"]);
  assert.doesNotMatch(pairs[0].question, /背诵清单/);
});

test("ignores a unique English chapter heading before a cross-page answer", () => {
  const pairs = inferQuestionAnswerPairs([
    {
      text: "1. CPU 的中文名称是______。",
      location: "第 1 页",
    },
    {
      text: "CHAPTER TWO",
      redText: "CHAPTER TWO",
      location: "第 2 页",
    },
    {
      text: "中央处理器",
      redText: "中央处理器",
      location: "第 2 页",
    },
  ]);

  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].answers, ["中央处理器"]);
});

test("rejects an ambiguous red answer when it does not match the blank count", () => {
  const pairs = inferQuestionAnswerPairs([
    { text: "1. CPU 由______和______组成。" },
    { text: "运算器 控制器 寄存器", redText: "运算器 控制器 寄存器" },
  ]);

  assert.deepEqual(pairs, []);
});

test("uses original worksheet stems and keeps multi-answer items as fill questions", () => {
  const points = [
    {
      id: "one",
      text: "程序；数据；文档",
      context: "软件运行所需要的______、______和______。",
      question: "软件运行所需要的______、______和______。",
      answerParts: ["程序", "数据", "文档"],
      sourceName: "sample.pdf",
      location: "第 1 页",
      method: "pdf-color",
      createdAt: 1,
    },
  ];
  const [question] = buildQuestions(points);

  assert.equal(question.type, "fill");
  assert.equal(question.stem, points[0].question);
  assert.equal(question.answer, "程序；数据；文档");
  assert.equal(question.explanation, "完整答案：程序；数据；文档");
  assert.equal(isAnswerCorrect("程序 数据 文档", question), true);
  assert.equal(isAnswerCorrect("程序；数据", question), false);
  assert.equal(isAnswerCorrect("程序数据文档", question), false);
  assert.equal(isAnswerCorrect("数据；程序；文档", question), false);
});

test("checks repeated blanks and slash alternatives by position", () => {
  const repeated = {
    answer: "数据总线；数据总线",
    answerParts: ["数据总线", "数据总线"],
  };
  assert.equal(isAnswerCorrect("数据总线；数据总线", repeated), true);
  assert.equal(isAnswerCorrect("数据总线", repeated), false);

  const alternatives = {
    answer: "操作码；地址码/操作数",
    answerParts: ["操作码", "地址码/操作数"],
  };
  assert.equal(isAnswerCorrect("操作码；地址码", alternatives), true);
  assert.equal(isAnswerCorrect("操作码；操作数", alternatives), true);
  assert.equal(isAnswerCorrect("操作码；数据码", alternatives), false);
});

test("auto-accepts explicit aliases and asks for confirmation on broader paraphrases", () => {
  const storageRule = {
    type: "fill",
    answer: "只能读取数据不能写入数据",
    answerParts: ["只能读取数据不能写入数据"],
  };
  assert.equal(
    isAnswerCorrect("可以读数据，但不可以写数据", storageRule),
    true,
  );

  const processing = {
    type: "fill",
    answer: "算术逻辑运算（数据的加工和处理）",
    answerParts: ["算术逻辑运算（数据的加工和处理）"],
  };
  const broadParaphrase = gradeAnswer(
    "对数据做算术与逻辑加工处理",
    processing,
  );
  assert.equal(broadParaphrase.verdict, "needs-confirmation");
  assert.equal(isAnswerCorrect("对数据做算术与逻辑加工处理", processing), false);
  assert.ok(
    answerMeaningSimilarity(
      "对数据做算术与逻辑加工处理",
      "算术逻辑运算（数据的加工和处理）",
    ) >= 0.66,
  );
  assert.equal(isMeaningClose("CPU", "中央处理器"), true);
});

test("keeps negation, order and choice answers strict", () => {
  const fill = {
    type: "fill",
    answer: "只能读取数据不能写入数据",
    answerParts: ["只能读取数据不能写入数据"],
  };
  assert.equal(isAnswerCorrect("可以读取数据也可以写入数据", fill), false);

  const choice = {
    type: "choice",
    answer: "只能读取数据不能写入数据",
    answerParts: ["只能读取数据不能写入数据"],
  };
  assert.equal(
    isAnswerCorrect("可以读数据，但不可以写数据", choice),
    false,
  );
});

test("rejects high-overlap answers that reverse a key fact", () => {
  const wrongPairs = [
    [
      "可以读数据但不可以写数据",
      "不可以读数据但可以写数据",
    ],
    ["CPU由运算器和控制器组成", "CPU"],
    ["数据传输速度增加", "数据传输速度减少"],
    [
      "运算器负责算术运算和逻辑运算",
      "控制器负责算术运算和逻辑运算",
    ],
    ["内存包括RAM和ROM", "内存包括RAM或ROM"],
    ["函数在x>0时递增", "函数在x<0时递增"],
    ["输入设备用于向计算机输入数据", "输出设备用于向计算机输出数据"],
  ];

  for (const [expected, submitted] of wrongPairs) {
    assert.equal(
      isAnswerCorrect(submitted, {
        type: "fill",
        answer: expected,
        answerParts: [expected],
      }),
      false,
      `${submitted} should not match ${expected}`,
    );
  }
});

test("never auto-accepts high-overlap role, order, scope, or category changes", () => {
  const pairs = [
    ["左结合", "右结合"],
    ["前序遍历", "后序遍历"],
    ["静态存储", "动态存储"],
    ["局域网", "广域网"],
    ["十进制", "二进制"],
    ["同步", "异步"],
    ["至少三个", "至多三个"],
    ["真子集", "子集"],
    ["系统软件", "支撑软件"],
    ["先启动后安装", "先安装后启动"],
    ["A负责接收B负责发送", "A负责发送B负责接收"],
    ["源地址写发送方，目的地址写接收方", "源地址写接收方，目的地址写发送方"],
  ];
  for (const [expected, submitted] of pairs) {
    const grade = gradeAnswer(submitted, {
      type: "fill",
      answer: expected,
      answerParts: [expected],
    });
    assert.notEqual(grade.verdict, "correct", `${submitted} must not auto-pass`);
  }
});

test("preserves meaningful punctuation, sign, spacing, apostrophes, and case", () => {
  for (const [expected, submitted] of [
    ["everyday", "every day"],
    ["its", "it's"],
    ["were", "we're"],
    ["us", "US"],
    ["3.14", "314"],
    ["-5", "5"],
  ]) {
    for (const type of ["choice", "fill"]) {
      assert.equal(
        isAnswerCorrect(submitted, {
          type,
          answer: expected,
          answerParts: [expected],
        }),
        false,
        `${type}: ${submitted} must stay distinct from ${expected}`,
      );
    }
  }
});

test("compares every number in both directions for fill grading", () => {
  for (const [expected, submitted] of [
    ["3.14", "314"],
    ["-5", "5"],
    ["复习间隔逐步延长", "复习间隔逐步延长3天"],
    ["有写权限", "没有写权限"],
  ]) {
    assert.equal(
      gradeAnswer(submitted, {
        type: "fill",
        answer: expected,
        answerParts: [expected],
      }).verdict,
      "incorrect",
      `${submitted} must not match ${expected}`,
    );
  }
});

test("does not treat protocol, fraction or algebra slashes as alternatives", () => {
  for (const [expected, submitted] of [
    ["TCP/IP", "TCP"],
    ["1/2", "1"],
    ["x/y", "x"],
  ]) {
    assert.equal(
      isAnswerCorrect(submitted, {
        type: "fill",
        answer: expected,
        answerParts: [expected],
      }),
      false,
    );
  }
  assert.equal(
    isAnswerCorrect("地址码", {
      type: "fill",
      answer: "地址码/操作数",
      answerParts: ["地址码/操作数"],
    }),
    true,
  );
  for (const [expected, submitted] of [
    ["CPU/中央处理器", "CPU"],
    ["CPU/中央处理器", "中央处理器"],
    ["OS/操作系统", "OS"],
    ["OS/操作系统", "操作系统"],
  ]) {
    assert.equal(
      isAnswerCorrect(submitted, {
        type: "fill",
        answer: expected,
        answerParts: [expected],
      }),
      true,
      `${submitted} should be accepted as an explicit bilingual alternative`,
    );
  }
});
