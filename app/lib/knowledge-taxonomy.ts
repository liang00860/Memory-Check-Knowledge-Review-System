export const STUDY_SUBJECTS = [
  "大学英语",
  "计算机基础",
  "大学语文",
  "高等数学",
  "其他",
] as const;

export const KNOWLEDGE_TAXONOMY_VERSION = 1;

export type StudySubject = (typeof STUDY_SUBJECTS)[number];

export const SUBJECT_CATEGORY_OPTIONS: Record<StudySubject, readonly string[]> = {
  大学英语: [
    "补全对话",
    "词汇与语法",
    "阅读理解",
    "选词填空",
    "句子填空",
    "完形填空",
    "英语综合",
  ],
  计算机基础: [
    "基础与信息表示",
    "硬件与系统组成",
    "操作系统",
    "办公软件",
    "网络与信息安全",
    "数据库与程序设计",
    "计算机综合",
  ],
  大学语文: [
    "语言文字基础",
    "文学文化常识",
    "古诗文阅读",
    "现代文阅读",
    "写作",
    "语文综合",
  ],
  高等数学: [
    "函数与极限",
    "导数与微分",
    "积分",
    "线性代数",
    "概率统计",
    "空间解析几何",
    "高数综合",
  ],
  其他: ["综合知识"],
};

export type ClassificationInput = {
  title?: string;
  stem?: string;
  question?: string;
  context?: string;
  text?: string;
  explanation?: string;
  sourceName?: string;
  answer?: string;
  answerParts?: string[];
  choices?: string[];
  subject?: StudySubject;
  knowledgeCategory?: string;
  classificationConfidence?: number;
  classificationVersion?: number;
  classificationSource?: "auto" | "user";
};

export type KnowledgeClassification = {
  subject: StudySubject;
  category: string;
  confidence: number;
  reasons: string[];
};

type WeightedRule = {
  pattern: RegExp;
  weight: number;
  reason: string;
};

const SUBJECT_RULES: Record<Exclude<StudySubject, "其他">, WeightedRule[]> = {
  大学英语: [
    {
      pattern: /英语|english|词汇|语法|时态|语态|虚拟语气|非谓语|定语从句|状语从句|主谓一致|cloze|grammar|vocabulary/u,
      weight: 5,
      reason: "英语题型或语法词",
    },
    {
      pattern: /\b(?:if|would|should|could|might|have|has|had|which|that|who|whom|whose|although|because|unless|whether)\b/iu,
      weight: 2.4,
      reason: "英文语法结构",
    },
  ],
  计算机基础: [
    {
      pattern: /(?:\bc(?:\+\+|#)?\s*语言|python|java(?:script)?|typescript|html|css|数据库|sql|select\s+.+\s+from|程序设计|源代码|编程|代码|编译器|解释器|变量|数组|指针|类与对象|递归|数据结构)/iu,
      weight: 7,
      reason: "编程或数据库强语境",
    },
    {
      pattern: /计算机|微型机|信息技术|冯[·・]?诺依曼|二进制|十六进制|编码|数制|位权|指令|操作码|地址码|操作数|存储程序|程序控制/u,
      weight: 5,
      reason: "计算机基础术语",
    },
    {
      pattern: /\bcpu\b|中央处理器|运算器|控制器|\bram\b|\brom\b|\bcache\b|存储器|内存|外存|硬盘|磁盘|扇区|磁道|柱面|主板|芯片|总线|\busb\b|i\/o|输入设备|输出设备/iu,
      weight: 5.5,
      reason: "计算机硬件术语",
    },
    {
      pattern: /操作系统|系统软件|应用软件|进程|线程|文件管理|存储管理|设备管理|windows|linux/iu,
      weight: 5.5,
      reason: "操作系统术语",
    },
    {
      pattern: /(?:microsoft|ms)\s*word|word\s*(?:文档|处理|软件)|文字处理软件|office|excel|powerpoint|wps|数据库|sql|程序设计|算法|网络|ip地址|域名|协议|信息安全|病毒|防火墙/iu,
      weight: 5.5,
      reason: "计算机应用术语",
    },
  ],
  大学语文: [
    {
      pattern: /大学语文|语文|文言文|古诗|诗词|现代文|文学|作家|作品|修辞|成语|病句|汉字|文化常识/u,
      weight: 5,
      reason: "语文或文学术语",
    },
    {
      pattern: /论语|孟子|诗经|楚辞|史记|唐诗|宋词|鲁迅|李白|杜甫|苏轼|陶渊明/u,
      weight: 4.5,
      reason: "文学作品或作者",
    },
    {
      pattern: /作文|写作|议论文|记叙文|应用文|主旨|中心思想|表达方式/u,
      weight: 4,
      reason: "阅读写作术语",
    },
  ],
  高等数学: [
    {
      pattern: /高等数学|极限|连续|无穷小|无穷大|导数|微分|积分|定积分|不定积分|微分方程|函数(?:的)?(?:定义域|值域|极限|连续性|导数|图像|单调性|奇偶性)/u,
      weight: 5,
      reason: "微积分术语",
    },
    {
      pattern: /矩阵|行列式|向量|线性方程组|特征值|线性代数/u,
      weight: 5,
      reason: "线性代数术语",
    },
    {
      pattern: /概率|随机变量|概率分布|期望|方差|统计学|统计量|样本|总体|均值|排列组合/u,
      weight: 5,
      reason: "概率统计术语",
    },
    {
      pattern: /空间解析几何|平面方程|直线方程|曲面|二次曲面/u,
      weight: 4.5,
      reason: "空间解析几何术语",
    },
    {
      pattern: /lim\b|∫|∑|[a-z]\s*['′]\s*\(|\bd[xy]\b|[a-z]\^\d/iu,
      weight: 3.2,
      reason: "数学符号结构",
    },
    {
      pattern: /\b(?:derivative|differentiat(?:e|ion)|integral|limit|matrix|determinant|vector|probability|equation|polynomial|calculus)\b/iu,
      weight: 6,
      reason: "英文数学术语",
    },
  ],
};

const CATEGORY_RULES: Record<Exclude<StudySubject, "其他">, Array<{
  category: string;
  rules: WeightedRule[];
}>> = {
  大学英语: [
    {
      category: "补全对话",
      rules: [
        { pattern: /补全对话|对话|conversation|dialogue|speaker|a:\s*.+b:/iu, weight: 6, reason: "对话补全结构" },
      ],
    },
    {
      category: "阅读理解",
      rules: [
        { pattern: /阅读理解|read the (?:following )?passage|according to (?:the )?(?:passage|text)|the passage|文章主旨/iu, weight: 6, reason: "阅读理解题干" },
      ],
    },
    {
      category: "选词填空",
      rules: [
        { pattern: /选词填空|word bank|从方框|所给词|choose (?:the )?word/iu, weight: 6, reason: "选词填空题干" },
      ],
    },
    {
      category: "完形填空",
      rules: [
        { pattern: /完形填空|cloze|完形/u, weight: 6, reason: "完形填空题干" },
      ],
    },
    {
      category: "句子填空",
      rules: [
        { pattern: /句子填空|补全句子|选句填空|sentence completion|______|_{2,}|＿{2,}/iu, weight: 3.5, reason: "句子挖空结构" },
      ],
    },
    {
      category: "词汇与语法",
      rules: [
        { pattern: /词汇|语法|时态|语态|从句|虚拟语气|非谓语|主谓一致|近义词|同义词|grammar|vocabulary|closest\s+in\s+meaning|\bsynonym\b|\bmeans?\b|\b(?:tense|voice|clause|conditional|participle|infinitive|agreement|if|would|should|had)\b/iu, weight: 4, reason: "词汇语法考点" },
      ],
    },
  ],
  计算机基础: [
    {
      category: "操作系统",
      rules: [
        { pattern: /操作系统|进程|线程|调度|文件管理|存储管理|设备管理|作业管理|windows|linux|os\b/iu, weight: 6, reason: "操作系统考点" },
      ],
    },
    {
      category: "硬件与系统组成",
      rules: [
        { pattern: /\bcpu\b|中央处理器|运算器|控制器|\bram\b|\brom\b|\bcache\b|存储器|内存|外存|硬盘|磁盘|扇区|磁道|柱面|主板|芯片|总线|\busb\b|i\/o|输入设备|输出设备|硬件系统|存储程序|程序控制|冯[·・]?诺依曼/iu, weight: 6, reason: "硬件组成考点" },
      ],
    },
    {
      category: "办公软件",
      rules: [
        { pattern: /(?:microsoft|ms)\s*word|word\s*(?:文档|处理|软件)|文字处理软件|\bexcel\b|\bpowerpoint\b|\bwps\b|文档编辑|电子表格|演示文稿/iu, weight: 6, reason: "办公软件考点" },
      ],
    },
    {
      category: "网络与信息安全",
      rules: [
        { pattern: /计算机网络|互联网|ip地址|域名|tcp|udp|http|协议|信息安全|病毒|木马|防火墙|加密/iu, weight: 6, reason: "网络安全考点" },
      ],
    },
    {
      category: "数据库与程序设计",
      rules: [
        { pattern: /数据库|sql|select\s+.+\s+from|关系模型|数据表|程序设计|算法|流程图|变量|数组|指针|循环|分支结构|编译|解释器|\bc(?:\+\+|#)?\s*语言|python|java(?:script)?|typescript|html|css/iu, weight: 6, reason: "数据库或程序设计考点" },
      ],
    },
    {
      category: "基础与信息表示",
      rules: [
        { pattern: /计算机|信息技术|冯[·・]?诺依曼|二进制|十六进制|编码|数制|位权|软件|数据|指令|操作码|地址码|操作数/u, weight: 3.5, reason: "计算机基础考点" },
      ],
    },
  ],
  大学语文: [
    {
      category: "写作",
      rules: [
        { pattern: /作文|写作|议论文|记叙文|应用文|审题|立意/u, weight: 6, reason: "写作考点" },
      ],
    },
    {
      category: "古诗文阅读",
      rules: [
        { pattern: /文言文|古诗|诗词|诗经|楚辞|唐诗|宋词|翻译下列|古文/u, weight: 6, reason: "古诗文考点" },
      ],
    },
    {
      category: "现代文阅读",
      rules: [
        { pattern: /现代文|阅读理解|主旨|中心思想|段落作用|表达方式/u, weight: 5, reason: "现代文阅读考点" },
      ],
    },
    {
      category: "文学文化常识",
      rules: [
        { pattern: /文学|作家|作品|文化常识|朝代|流派|论语|孟子|史记|鲁迅|李白|杜甫|苏轼/u, weight: 5, reason: "文学文化常识" },
      ],
    },
    {
      category: "语言文字基础",
      rules: [
        { pattern: /汉字|字音|字形|词语|成语|病句|修辞|标点/u, weight: 5, reason: "语言文字考点" },
      ],
    },
  ],
  高等数学: [
    {
      category: "概率统计",
      rules: [
        { pattern: /概率|随机变量|概率分布|期望|方差|统计学|统计量|样本|总体|均值|排列组合|\bprobability\b/iu, weight: 6, reason: "概率统计考点" },
      ],
    },
    {
      category: "线性代数",
      rules: [
        { pattern: /矩阵|行列式|向量|线性方程组|特征值|线性代数|\bmatrix\b|\bdeterminant\b|\bvector\b/iu, weight: 6, reason: "线性代数考点" },
      ],
    },
    {
      category: "空间解析几何",
      rules: [
        { pattern: /空间解析几何|平面方程|直线方程|曲面|二次曲面/u, weight: 6, reason: "空间解析几何考点" },
      ],
    },
    {
      category: "积分",
      rules: [
        { pattern: /积分|定积分|不定积分|∫|原函数|\bintegral\b/iu, weight: 6, reason: "积分考点" },
      ],
    },
    {
      category: "导数与微分",
      rules: [
        { pattern: /导数|微分|微分方程|切线|单调性|极值|凹凸|\bderivative\b|\bdifferentiat(?:e|ion)\b/iu, weight: 6, reason: "导数微分考点" },
      ],
    },
    {
      category: "函数与极限",
      rules: [
        { pattern: /函数(?:的)?(?:定义域|值域|极限|连续性|导数|图像|单调性|奇偶性)|极限|连续|无穷小|无穷大|lim\b|\blimit\b|\bpolynomial\b/iu, weight: 5, reason: "函数极限考点" },
      ],
    },
  ],
};

function normalizedInput(input: ClassificationInput) {
  return [
    input.title,
    input.stem,
    input.question,
    input.context,
    input.text,
    input.explanation,
    input.sourceName,
    input.answer,
    ...(input.answerParts || []),
  ]
    .filter(Boolean)
    .join("\n")
    .normalize("NFKC")
    .replace(/\u00a0/gu, " ")
    .toLowerCase();
}

function scoreRules(text: string, rules: WeightedRule[]) {
  let score = 0;
  const reasons: string[] = [];
  rules.forEach((rule) => {
    if (!rule.pattern.test(text)) return;
    score += rule.weight;
    if (!reasons.includes(rule.reason)) reasons.push(rule.reason);
  });
  return { score, reasons };
}

function categoryFor(subject: Exclude<StudySubject, "其他">, text: string) {
  const ranked = CATEGORY_RULES[subject]
    .map((candidate, index) => ({
      ...candidate,
      index,
      ...scoreRules(text, candidate.rules),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0];
  return best && best.score > 0
    ? { category: best.category, reason: best.reasons[0] }
    : {
        category: {
          大学英语: "英语综合",
          计算机基础: "计算机综合",
          大学语文: "语文综合",
          高等数学: "高数综合",
        }[subject],
        reason: "按学科默认大类归档",
      };
}

export function classifyKnowledge(
  input: ClassificationInput,
): KnowledgeClassification {
  if (
    input.subject &&
    STUDY_SUBJECTS.includes(input.subject) &&
    (
      input.classificationSource === "user" ||
      (
        input.subject !== "其他" &&
        input.classificationVersion === KNOWLEDGE_TAXONOMY_VERSION
      )
    )
  ) {
    const allowedCategories = SUBJECT_CATEGORY_OPTIONS[input.subject];
    const category =
      input.knowledgeCategory &&
      allowedCategories.includes(input.knowledgeCategory)
        ? input.knowledgeCategory
        : input.subject === "其他"
          ? "综合知识"
          : categoryFor(input.subject, normalizedInput(input)).category;
    return {
      subject: input.subject,
      category,
      confidence:
        typeof input.classificationConfidence === "number"
          ? Math.min(1, Math.max(0.5, input.classificationConfidence))
          : 0.9,
      reasons: ["沿用知识点已确认的分类"],
    };
  }
  const text = normalizedInput(input);
  if (!text.trim()) {
    return {
      subject: "其他",
      category: "综合知识",
      confidence: 0.2,
      reasons: ["内容为空，使用兜底分类"],
    };
  }

  const ranked = (Object.keys(SUBJECT_RULES) as Array<Exclude<StudySubject, "其他">>)
    .map((subject, index) => {
      const result = scoreRules(text, SUBJECT_RULES[subject]);
      return { subject, index, ...result };
    });

  const englishWords = text.match(/[a-z]+(?:'[a-z]+)?/giu) || [];
  const choiceText = (input.choices || []).join(" ").normalize("NFKC");
  const choiceEnglishWords =
    choiceText.match(/[a-z]+(?:['’][a-z]+)?/giu) || [];
  const choiceHanCount =
    (choiceText.match(/[\u3400-\u9fff]/gu) || []).length;
  const commonEnglishWords = text.match(
    /\b(?:the|a|an|is|are|was|were|if|would|should|have|has|do|does|which|that|because|although|however|to|of|in|on|for|with)\b/giu,
  ) || [];
  const hanCount = (text.match(/[\u3400-\u9fff]/gu) || []).length;
  const englishLetters = (text.match(/[a-z]/giu) || []).length;
  const englishSignal = ranked.find((entry) => entry.subject === "大学英语")!;
  const strongNonEnglishScore = Math.max(
    0,
    ...ranked
      .filter((entry) => entry.subject !== "大学英语")
      .map((entry) => entry.score),
  );
  if (
    strongNonEnglishScore < 4.5 &&
    englishWords.length >= 4 &&
    englishLetters / Math.max(1, englishLetters + hanCount) >= 0.42
  ) {
    englishSignal.score += 2.8;
    englishSignal.reasons.push("连续英文句子");
  }
  if (strongNonEnglishScore < 4.5 && commonEnglishWords.length >= 2) {
    englishSignal.score += Math.min(2.4, commonEnglishWords.length * 0.4);
    englishSignal.reasons.push("英文功能词结构");
  }
  if (
    strongNonEnglishScore < 4.5 &&
    (input.choices?.length || 0) >= 3 &&
    choiceEnglishWords.length >= 4 &&
    choiceEnglishWords.join("").length >
      Math.max(1, choiceHanCount * 1.5)
  ) {
    englishSignal.score += 3.2;
    englishSignal.reasons.push("英文多选项结构");
  }

  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.score < 2.5) {
    return {
      subject: "其他",
      category: "综合知识",
      confidence: 0.35,
      reasons: ["未命中明确学科规则"],
    };
  }

  const hasShortEnglishOptions =
    (input.choices?.length || 0) >= 3 &&
    (input.choices || []).every((choice) => {
      const words = choice.match(/[a-z]+(?:['’][a-z]+)?/giu) || [];
      return words.length >= 1 &&
        words.length <= 4 &&
        !/[\u3400-\u9fff]/u.test(choice);
    });
  const category = categoryFor(
    best.subject,
    [
      text,
      choiceText,
      best.subject === "大学英语" && hasShortEnglishOptions
        ? "vocabulary"
        : "",
    ].filter(Boolean).join("\n"),
  );
  const margin = Math.max(0, best.score - (runnerUp?.score || 0));
  const confidence = Math.min(
    0.98,
    Math.max(0.5, 0.55 + (margin / Math.max(4, best.score + 2)) * 0.4),
  );
  return {
    subject: best.subject,
    category: category.category,
    confidence: Number(confidence.toFixed(2)),
    reasons: [...new Set([...best.reasons, `大类：${category.reason}`])].slice(0, 4),
  };
}

export function sortStudySubjects(values: Iterable<StudySubject>) {
  const unique = new Set(values);
  return STUDY_SUBJECTS.filter((subject) => unique.has(subject));
}
