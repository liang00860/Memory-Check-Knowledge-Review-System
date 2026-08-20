"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, set } from "idb-keyval";
import {
  AlertCircle,
  BookOpen,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  LibraryBig,
  Pencil,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  knowledgePointIdentity,
  parseKnowledgeDocument,
  type KnowledgePoint,
  type ParseProgress,
} from "./lib/document-parser";
import {
  REVIEW_INTERVALS,
  buildQuestions,
  formatDue,
  gradeAnswer,
  initialRecord,
  updateRecord,
  type AnswerGrade,
  type Attempt,
  type Question,
  type ReviewRecord,
} from "./lib/study";
import {
  LEARNING_IMPORT_TEMPLATE,
  SICHUAN_CHOICE_EXAM_NOTE,
  buildTodayChoiceQuestionBank,
  learningItemPointId,
  learningItemToKnowledgePoint,
  mergeTodayLearningItems,
  parseLearningImportFile,
  parseLearningImportText,
  selectTodayExamQuestions,
  isSameLocalDay,
  type TodayLearningItem,
} from "./lib/today-learning";
import {
  KNOWLEDGE_TAXONOMY_VERSION,
  classifyKnowledge,
  sortStudySubjects,
  type KnowledgeClassification,
  type StudySubject,
} from "./lib/knowledge-taxonomy";

const STORAGE_KEY = "yijian-study-state-v2";
const LEGACY_STORAGE_KEY = "yijian-study-state-v1";

type AppView = "library" | "today" | "quiz" | "review";
type QuizMode = "study" | "today";
type SubjectFilter = StudySubject | "all";

type StoredState = {
  schemaVersion: 2;
  points: KnowledgePoint[];
  records: Record<string, ReviewRecord>;
  attempts: Attempt[];
  todayItems: TodayLearningItem[];
  session?: {
    questions: Question[];
    questionIndex: number;
    answer: string;
    checked: boolean;
    lastCorrect: boolean | null;
    pendingGrade: AnswerGrade | null;
    quizMode: QuizMode;
    sessionResults: boolean[];
  };
};

type LegacyStoredState = Omit<StoredState, "schemaVersion" | "todayItems"> & {
  schemaVersion?: 1;
  todayItems?: TodayLearningItem[];
};

const DEMO_POINTS: Omit<KnowledgePoint, "id" | "createdAt">[] = [
  {
    text: "海马体",
    context: "海马体在新记忆的形成与空间导航中发挥重要作用。",
    sourceName: "认知心理学示例.docx",
    location: "第 3 段",
    method: "docx-color",
  },
  {
    text: "间隔效应",
    context: "间隔效应指将学习分散到多个时间段比集中学习更有利于长期记忆。",
    sourceName: "认知心理学示例.docx",
    location: "第 8 段",
    method: "docx-color",
  },
  {
    text: "提取练习",
    context: "提取练习通过主动回忆来加强记忆，而不仅是重复阅读材料。",
    sourceName: "认知心理学示例.docx",
    location: "第 12 段",
    method: "docx-color",
  },
  {
    text: "工作记忆",
    context: "工作记忆是对当前任务所需信息进行短时保持和加工的系统。",
    sourceName: "认知心理学示例.docx",
    location: "第 17 段",
    method: "docx-color",
  },
  {
    text: "长时记忆",
    context: "长时记忆能够在较长时间内保存知识、经验和技能。",
    sourceName: "认知心理学示例.docx",
    location: "第 22 段",
    method: "docx-color",
  },
  {
    text: "遗忘曲线",
    context: "遗忘曲线表明遗忘在学习后早期较快，之后速度逐渐减慢。",
    sourceName: "认知心理学示例.docx",
    location: "第 26 段",
    method: "docx-color",
  },
];

function IntroSequence({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const finished = useRef(false);

  const complete = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    let revertMedia: (() => void) | undefined;
    const fallbackTimer = window.setTimeout(complete, 4_500);

    void import("gsap").then(({ gsap }) => {
      if (cancelled || !root.current) return;
      const mm = gsap.matchMedia();
      revertMedia = () => mm.revert();
      mm.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          reduceMotion: "(prefers-reduced-motion: reduce)",
          compact: "(max-width: 760px), (max-height: 600px)",
        },
        (context) => {
          const { reduceMotion, compact } = context.conditions as {
            reduceMotion: boolean;
            compact: boolean;
          };
          if (reduceMotion) {
            gsap.set(root.current, { autoAlpha: 0 });
            complete();
            return;
          }

          const icons = gsap.utils
            .toArray<HTMLElement>(".intro-icon", root.current)
            .filter((icon) => icon.getClientRects().length > 0);
          const labels = gsap.utils
            .toArray<HTMLElement>(".intro-label", root.current)
            .filter((label) => label.getClientRects().length > 0);
          const tileCovers = gsap.utils
            .toArray<HTMLElement>(".intro-tile-cover", root.current)
            .filter((cover) => cover.getClientRects().length > 0);
          if (icons.length) gsap.set(icons, { autoAlpha: 0 });
          if (labels.length) gsap.set(labels, { autoAlpha: 0 });
          if (tileCovers.length) gsap.set(tileCovers, { autoAlpha: 1 });

          const timeline = gsap.timeline({ defaults: { ease: "none" } });
          timeline
            .to(icons, {
              autoAlpha: 1,
              duration: 0.5,
              stagger: { each: 0.08, from: "random" },
            }, 0.05);
          if (labels.length) {
            timeline.to(labels, {
              autoAlpha: 1,
              duration: compact ? 0.06 : 0.1,
              stagger: 0.1,
              repeat: 1,
              yoyo: true,
            }, 0.6);
          }
          timeline
            .to(tileCovers, {
              autoAlpha: 0.18,
              duration: 0.21,
              stagger: { amount: 0.28, from: "random" },
              repeat: 1,
              yoyo: true,
            }, 1.05)
            .to(tileCovers, {
              autoAlpha: 0,
              duration: 0.14,
              stagger: { amount: 0.66, from: "random" },
            }, 1.75)
            .to(".intro-content", { autoAlpha: 0, duration: 0.14 }, 1.9)
            .to(root.current, { autoAlpha: 0, duration: 0.14, onComplete: complete }, 2.42);
        },
        root.current,
      );
    }).catch(complete);

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      revertMedia?.();
    };
  }, [complete]);

  return (
    <div className="intro-root" ref={root} aria-hidden="true">
      <div className="intro-grid">
        {Array.from({ length: 30 }, (_, index) => (
          <div className={`intro-tile ${index % 4 === 1 ? "is-striped" : ""}`} key={index}>
            <span className="intro-tile-cover" />
          </div>
        ))}
      </div>
      <div className="intro-content">
        <div className="intro-mark-row">
          <span className="intro-icon intro-pixels" />
          <span className="intro-icon intro-wordmark">忆检</span>
          <span className="intro-icon intro-ring" />
          <span className="intro-icon intro-arrow">↗</span>
          <span className="intro-icon intro-hatch" />
          <div className="intro-tagline">
            <span className="intro-label">LOCAL FIRST</span>
            <span className="intro-label">ACTIVE RECALL</span>
            <span className="intro-label">SMART REVIEW</span>
          </div>
        </div>
        <ol className="intro-notes">
          <li>红色知识提取</li>
          <li>主动回忆训练</li>
          <li>遗忘曲线复习</li>
          <li>数据只留本机</li>
        </ol>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function TaxonomyFilter({
  label,
  subjects,
  subject,
  categories,
  category,
  onSubjectChange,
  onCategoryChange,
}: {
  label: string;
  subjects: StudySubject[];
  subject: SubjectFilter;
  categories: string[];
  category: string;
  onSubjectChange: (subject: SubjectFilter) => void;
  onCategoryChange: (category: string) => void;
}) {
  return (
    <section className="taxonomy-filter" aria-label={label}>
      <div className="taxonomy-row">
        <span>科目</span>
        <div className="taxonomy-options" role="group" aria-label={`${label}科目`}>
          <button
            type="button"
            className={subject === "all" ? "active" : ""}
            aria-pressed={subject === "all"}
            onClick={() => {
              onSubjectChange("all");
              onCategoryChange("all");
            }}
          >
            全部科目
          </button>
          {subjects.map((option) => (
            <button
              type="button"
              key={option}
              className={subject === option ? "active" : ""}
              aria-pressed={subject === option}
              onClick={() => {
                onSubjectChange(option);
                onCategoryChange("all");
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="taxonomy-row">
        <span>知识大类</span>
        <div className="taxonomy-options" role="group" aria-label={`${label}知识点大类`}>
          <button
            type="button"
            className={category === "all" ? "active" : ""}
            aria-pressed={category === "all"}
            onClick={() => onCategoryChange("all")}
          >
            全部大类
          </button>
          {categories.map((option) => (
            <button
              type="button"
              key={option}
              className={category === option ? "active" : ""}
              aria-pressed={category === option}
              onClick={() => onCategoryChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function isStoredTodayItem(value: unknown): value is TodayLearningItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TodayLearningItem>;
  return Boolean(
    typeof item.id === "string" &&
      item.id &&
      (item.source === "chatgpt" ||
        item.source === "codex" ||
        item.source === "manual") &&
      typeof item.occurredAt === "number" &&
      Number.isFinite(item.occurredAt) &&
      typeof item.title === "string" &&
      (item.kind === "choice" || item.kind === "knowledge") &&
      typeof item.stem === "string" &&
      Array.isArray(item.choices) &&
      item.choices.every((choice) => typeof choice === "string") &&
      typeof item.answer === "string" &&
      typeof item.explanation === "string" &&
      typeof item.knowledgePoint === "string" &&
      typeof item.originLabel === "string",
  );
}

function normalizeStoredState(value: unknown): StoredState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as LegacyStoredState;
  const points = Array.isArray(raw.points)
    ? raw.points
        .filter((point): point is KnowledgePoint =>
          Boolean(point && typeof point === "object" && point.id && point.text)
        )
        .map((point) => {
          const classification = classifyKnowledge(point);
          return {
            ...point,
            explanation:
              point.explanation ||
              (point.method === "history-import" ? point.context : undefined),
            subject: classification.subject,
            knowledgeCategory: classification.category,
            classificationConfidence: classification.confidence,
            classificationVersion: KNOWLEDGE_TAXONOMY_VERSION,
            classificationSource: "auto" as const,
          };
        })
    : [];
  const attempts = Array.isArray(raw.attempts) ? raw.attempts : [];
  const rawRecords =
    raw.records && typeof raw.records === "object" ? raw.records : {};
  const latestAttempt = new Map<string, Attempt>();
  attempts
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .forEach((attempt) => {
      if (!latestAttempt.has(attempt.pointId)) latestAttempt.set(attempt.pointId, attempt);
    });
  const records = Object.fromEntries(
    Object.entries(rawRecords).map(([pointId, record]) => [
      pointId,
      {
        ...record,
        lastCorrect:
          typeof record.lastCorrect === "boolean"
            ? record.lastCorrect
            : latestAttempt.get(pointId)?.correct ?? null,
      },
    ]),
  );
  const rawQuestions = Array.isArray(raw.session?.questions)
    ? raw.session.questions.filter((question): question is Question =>
        Boolean(
          question &&
          typeof question === "object" &&
          question.id &&
          question.pointId &&
          question.stem &&
          question.answer,
        )
      )
    : [];
  const requestedIndex = Number.isInteger(raw.session?.questionIndex)
    ? Number(raw.session?.questionIndex)
    : 0;
  const safeIndex =
    requestedIndex >= 0 && requestedIndex < rawQuestions.length
      ? requestedIndex
      : 0;
  const checked = Boolean(raw.session?.checked);
  const pendingGrade =
    checked &&
    raw.session?.pendingGrade?.verdict === "needs-confirmation"
      ? raw.session.pendingGrade
      : null;
  const completedCount = safeIndex + (checked && !pendingGrade ? 1 : 0);
  const savedResults = Array.isArray(raw.session?.sessionResults)
    ? raw.session.sessionResults.filter(
        (result): result is boolean => typeof result === "boolean",
      )
    : [];
  const resumableResults =
    savedResults.length >= completedCount
      ? savedResults.slice(0, completedCount)
      : [];
  const canResumeAtSavedIndex =
    completedCount === 0 || resumableResults.length === completedCount;
  const session = rawQuestions.length
    ? {
        questions: rawQuestions,
        questionIndex: canResumeAtSavedIndex ? safeIndex : 0,
        answer:
          canResumeAtSavedIndex && typeof raw.session?.answer === "string"
            ? raw.session.answer
            : "",
        checked: canResumeAtSavedIndex && checked,
        lastCorrect:
          canResumeAtSavedIndex &&
          typeof raw.session?.lastCorrect === "boolean"
            ? raw.session.lastCorrect
            : null,
        pendingGrade: canResumeAtSavedIndex ? pendingGrade : null,
        quizMode:
          raw.session?.quizMode === "today"
            ? "today" as const
            : "study" as const,
        sessionResults: canResumeAtSavedIndex ? resumableResults : [],
      }
    : undefined;
  return {
    schemaVersion: 2,
    points,
    records,
    attempts,
    todayItems: Array.isArray(raw.todayItems)
      ? raw.todayItems.filter(isStoredTodayItem)
      : [],
    session,
  };
}

function App() {
  const [introVisible, setIntroVisible] = useState(true);
  const [view, setView] = useState<AppView>("library");
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [records, setRecords] = useState<Record<string, ReviewRecord>>({});
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [todayItems, setTodayItems] = useState<TodayLearningItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [pendingGrade, setPendingGrade] = useState<AnswerGrade | null>(null);
  const [advanceReady, setAdvanceReady] = useState(true);
  const [quizMode, setQuizMode] = useState<QuizMode>("study");
  const [sessionResults, setSessionResults] = useState<boolean[]>([]);
  const [historyText, setHistoryText] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  const [historyImporting, setHistoryImporting] = useState(false);
  const [todayQuestionCount, setTodayQuestionCount] = useState(10);
  const [includeDocumentPoints, setIncludeDocumentPoints] = useState(false);
  const [todaySubjectFilter, setTodaySubjectFilter] = useState<SubjectFilter>("all");
  const [todayCategoryFilter, setTodayCategoryFilter] = useState("all");
  const [studySubjectFilter, setStudySubjectFilter] = useState<SubjectFilter>("all");
  const [studyCategoryFilter, setStudyCategoryFilter] = useState("all");
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const historyInputRef = useRef<HTMLInputElement>(null);
  const parsingRef = useRef(false);
  const submitLockRef = useRef(false);
  const gradeCommittedRef = useRef(false);
  const pointsRef = useRef<KnowledgePoint[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const finishIntro = useCallback(() => setIntroVisible(false), []);

  useEffect(() => {
    get<unknown>(STORAGE_KEY)
      .then(async (stored) => stored ?? await get<unknown>(LEGACY_STORAGE_KEY))
      .then((stored) => {
        const normalized = normalizeStoredState(stored);
        if (!normalized) return;
        pointsRef.current = normalized.points;
        setPoints(pointsRef.current);
        setRecords(normalized.records);
        setAttempts(normalized.attempts);
        setTodayItems(normalized.todayItems);
        if (normalized.session?.questions.length) {
          setQuestions(normalized.session.questions);
          setQuestionIndex(normalized.session.questionIndex);
          setAnswer(normalized.session.answer);
          setChecked(normalized.session.checked);
          setLastCorrect(normalized.session.lastCorrect);
          setPendingGrade(normalized.session.pendingGrade);
          setQuizMode(normalized.session.quizMode);
          setSessionResults(normalized.session.sessionResults);
          setView("quiz");
        }
      })
      .catch(() => {
        setError("本地学习数据读取失败，已使用空白学习台。");
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const session = questions.length && questionIndex < questions.length
      ? {
          questions,
          questionIndex,
          answer,
          checked,
          lastCorrect,
          pendingGrade,
          quizMode,
          sessionResults,
        }
      : undefined;
    const snapshot = {
      schemaVersion: 2,
      points,
      records,
      attempts,
      todayItems,
      session,
    } satisfies StoredState;
    const timer = window.setTimeout(() => {
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => set(STORAGE_KEY, snapshot))
        .catch(() => {
          setError("本地保存失败，请检查浏览器是否允许站点存储。");
        });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [
    answer,
    attempts,
    checked,
    hydrated,
    lastCorrect,
    pendingGrade,
    points,
    questionIndex,
    questions,
    quizMode,
    records,
    sessionResults,
    todayItems,
  ]);

  useEffect(() => {
    if (!introVisible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [introVisible]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const duePoints = useMemo(
    () =>
      points.filter((point) => {
        const record = records[point.id];
        return !record || record.attempts === 0 || record.nextReviewAt <= now;
      }),
    [points, records, now],
  );
  const wrongPointIds = useMemo(
    () => {
      const latest = new Map<string, Attempt>();
      attempts.forEach((attempt) => {
        if (!latest.has(attempt.pointId)) latest.set(attempt.pointId, attempt);
      });
      return new Set(
        points
          .filter((point) => {
            const lastCorrect = records[point.id]?.lastCorrect;
            if (typeof lastCorrect === "boolean") return !lastCorrect;
            return latest.get(point.id)?.correct === false;
          })
          .map((point) => point.id),
      );
    },
    [attempts, points, records],
  );
  const nextReviewLabel = useMemo(() => {
    if (duePoints.length) return "已有内容到期";
    const nextTimestamp = points
      .map((point) => records[point.id]?.nextReviewAt)
      .filter((timestamp): timestamp is number => typeof timestamp === "number")
      .sort((a, b) => a - b)[0];
    return nextTimestamp ? formatDue(nextTimestamp, now) : "等待首次学习";
  }, [duePoints.length, now, points, records]);
  const accuracy = attempts.length
    ? Math.round((attempts.filter((attempt) => attempt.correct).length / attempts.length) * 100)
    : 0;
  const activeTodayItems = useMemo(
    () => todayItems.filter((item) => isSameLocalDay(item.occurredAt, now)),
    [now, todayItems],
  );
  const pointClassifications = useMemo(
    () => new Map<string, KnowledgeClassification>(
      points.map((point) => [point.id, classifyKnowledge(point)]),
    ),
    [points],
  );
  const classifiedPoints = useMemo(
    () => points.map((point) => ({
      point,
      classification: pointClassifications.get(point.id) || classifyKnowledge(point),
    })),
    [pointClassifications, points],
  );
  const studySubjects = useMemo(
    () => sortStudySubjects(classifiedPoints.map(({ classification }) => classification.subject)),
    [classifiedPoints],
  );
  const effectiveStudySubject: SubjectFilter =
    studySubjectFilter === "all" || studySubjects.includes(studySubjectFilter)
      ? studySubjectFilter
      : "all";
  const studySubjectRows = useMemo(
    () => classifiedPoints.filter(({ classification }) =>
      effectiveStudySubject === "all" || classification.subject === effectiveStudySubject
    ),
    [classifiedPoints, effectiveStudySubject],
  );
  const studyCategories = useMemo(
    () => [...new Set(
      studySubjectRows.map(({ classification }) => classification.category),
    )].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [studySubjectRows],
  );
  const effectiveStudyCategory =
    studyCategoryFilter === "all" || studyCategories.includes(studyCategoryFilter)
      ? studyCategoryFilter
      : "all";
  const filteredStudyPoints = useMemo(
    () => studySubjectRows
      .filter(({ classification }) =>
        effectiveStudyCategory === "all" ||
        classification.category === effectiveStudyCategory
      )
      .map(({ point }) => point),
    [effectiveStudyCategory, studySubjectRows],
  );
  const allTodayQuestionBank = useMemo(
    () => buildTodayChoiceQuestionBank(
      activeTodayItems,
      includeDocumentPoints ? points : [],
    ),
    [activeTodayItems, includeDocumentPoints, points],
  );
  const todaySubjects = useMemo(
    () => sortStudySubjects(
      allTodayQuestionBank.map((question) => question.subject || "其他"),
    ),
    [allTodayQuestionBank],
  );
  const effectiveTodaySubject: SubjectFilter =
    todaySubjectFilter === "all" || todaySubjects.includes(todaySubjectFilter)
      ? todaySubjectFilter
      : "all";
  const todaySubjectQuestionBank = useMemo(
    () => allTodayQuestionBank.filter((question) =>
      effectiveTodaySubject === "all" || question.subject === effectiveTodaySubject
    ),
    [allTodayQuestionBank, effectiveTodaySubject],
  );
  const todayCategories = useMemo(
    () => [...new Set(
      todaySubjectQuestionBank.map(
        (question) => question.knowledgeCategory || question.section || "综合知识",
      ),
    )].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [todaySubjectQuestionBank],
  );
  const effectiveTodayCategory =
    todayCategoryFilter === "all" || todayCategories.includes(todayCategoryFilter)
      ? todayCategoryFilter
      : "all";
  const todayQuestionBank = useMemo(
    () => todaySubjectQuestionBank.filter((question) =>
      effectiveTodayCategory === "all" ||
      question.knowledgeCategory === effectiveTodayCategory
    ),
    [effectiveTodayCategory, todaySubjectQuestionBank],
  );
  const eligibleTodayItemIds = useMemo(
    () => new Set(
      allTodayQuestionBank
        .map((question) => question.sourceItemId)
        .filter((itemId): itemId is string => Boolean(itemId)),
    ),
    [allTodayQuestionBank],
  );
  const todayItemClassifications = useMemo(
    () => new Map<string, KnowledgeClassification>(
      activeTodayItems.map((item) => [
        item.id,
        classifyKnowledge({ ...item, choices: item.choices }),
      ]),
    ),
    [activeTodayItems],
  );
  const todaySourceCounts = useMemo(
    () => ({
      chatgpt: activeTodayItems.filter((item) => item.source === "chatgpt").length,
      codex: activeTodayItems.filter((item) => item.source === "codex").length,
      manual: activeTodayItems.filter((item) => item.source === "manual").length,
    }),
    [activeTodayItems],
  );
  const sessionCorrect = sessionResults.filter(Boolean).length;
  const sessionAccuracy = sessionResults.length
    ? Math.round((sessionCorrect / sessionResults.length) * 100)
    : 0;
  const effectiveTodayQuestionCount = todayQuestionBank.length
    ? Math.min(Math.max(1, Math.floor(todayQuestionCount)), todayQuestionBank.length)
    : 1;

  const acceptFiles = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    if (!selectedFiles.length || parsingRef.current) return;
    parsingRef.current = true;
    setError("");
    setProgress({ percent: 1, label: "准备解析" });
    const extractedPoints: KnowledgePoint[] = [];
    const failures: string[] = [];
    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        try {
          const extracted = await parseKnowledgeDocument(file, (nextProgress) => {
            const overall = Math.round(((index + nextProgress.percent / 100) / selectedFiles.length) * 100);
            setProgress({
              percent: overall,
              label: selectedFiles.length > 1
                ? `[${index + 1}/${selectedFiles.length}] ${nextProgress.label}`
                : nextProgress.label,
            });
          });
          if (!extracted.length) {
            failures.push(`${file.name}：没有检测到标红文字`);
          } else {
            extractedPoints.push(...extracted);
          }
        } catch (caught) {
          failures.push(`${file.name}：${caught instanceof Error ? caught.message : "解析失败"}`);
        }
      }

      if (!extractedPoints.length) {
        throw new Error(failures.join("；") || "没有检测到标红文字。请确认文档中的文字为红色字体或红色高亮。");
      }

      const uniqueExtracted = extractedPoints.filter((point, index, source) => (
        source.findIndex((candidate) => (
          knowledgePointIdentity(candidate) === knowledgePointIdentity(point)
        )) === index
      ));
      const existing = new Set(
        pointsRef.current.map(knowledgePointIdentity),
      );
      const accepted = uniqueExtracted
        .filter((point) => {
          const key = knowledgePointIdentity(point);
          if (existing.has(key)) return false;
          existing.add(key);
          return true;
        })
        .map((point) => {
          const classification = classifyKnowledge(point);
          return {
            ...point,
            subject: classification.subject,
            knowledgeCategory: classification.category,
            classificationConfidence: classification.confidence,
            classificationVersion: KNOWLEDGE_TAXONOMY_VERSION,
            classificationSource: "auto" as const,
          };
        });
      pointsRef.current = [...pointsRef.current, ...accepted];
      setPoints(pointsRef.current);
      setRecords((current) => {
        const next = { ...current };
        accepted.forEach((point) => {
          next[point.id] ||= initialRecord(point.id);
        });
        return next;
      });
      if (failures.length) setError(`部分文件未导入：${failures.join("；")}`);
      window.setTimeout(() => setProgress(null), 850);
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "文档解析失败，请重试。");
    } finally {
      parsingRef.current = false;
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const mergeImportedLearning = (incoming: TodayLearningItem[]) => {
    if (!incoming.length) return;
    setTodayItems((current) => mergeTodayLearningItems(current, incoming));
  };

  const importHistoryFiles = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    if (!selectedFiles.length || historyImporting) return;
    setHistoryImporting(true);
    setHistoryNotice("");
    const imported: TodayLearningItem[] = [];
    const messages: string[] = [];
    let skipped = 0;
    try {
      for (const file of selectedFiles) {
        try {
          const result = await parseLearningImportFile(file);
          imported.push(...result.items);
          skipped += result.skipped;
          messages.push(...result.notices);
        } catch (caught) {
          messages.push(
            `${file.name}：${caught instanceof Error ? caught.message : "导入失败"}`,
          );
        }
      }
      const mergedIncoming = mergeTodayLearningItems([], imported);
      mergeImportedLearning(mergedIncoming);
      setHistoryNotice(
        mergedIncoming.length
          ? `已导入今天的 ${mergedIncoming.length} 条学习记录${skipped ? `，另有 ${skipped} 条因日期、重复或缺少答案/解析而跳过` : ""}。${messages.join(" ")}`
          : `没有发现今天可用的题目或知识点。${messages.join(" ")}`,
      );
    } finally {
      setHistoryImporting(false);
      if (historyInputRef.current) historyInputRef.current.value = "";
    }
  };

  const importHistoryText = () => {
    const result = parseLearningImportText(historyText, {
      sourceHint: "manual",
      originLabel: "手动粘贴",
    });
    mergeImportedLearning(result.items);
    setHistoryNotice(
      result.items.length
        ? `已导入今天的 ${result.items.length} 条记录${result.skipped ? `，跳过 ${result.skipped} 条无效、重复或非今日内容` : ""}。`
        : result.notices.join(" ") || "没有发现可用记录，请检查题目、选项、答案和解析是否完整。",
    );
    if (result.items.length) setHistoryText("");
  };

  const removeTodayItem = (itemId: string) => {
    setTodayItems((current) => current.filter((item) => item.id !== itemId));
    const pointId = learningItemPointId({ id: itemId });
    const hasAttempts = attempts.some((attempt) => attempt.pointId === pointId);
    if (hasAttempts) {
      setHistoryNotice("已从今日导入清单移除；既有作答与复习记录仍保留。");
      return;
    }
    pointsRef.current = pointsRef.current.filter((point) => point.id !== pointId);
    setPoints(pointsRef.current);
    setRecords((current) => {
      const next = { ...current };
      delete next[pointId];
      return next;
    });
  };

  const loadDemo = () => {
    const created = DEMO_POINTS.map((point) => {
      const createdPoint = {
        ...point,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      const classification = classifyKnowledge(createdPoint);
      return {
        ...createdPoint,
        subject: classification.subject,
        knowledgeCategory: classification.category,
        classificationConfidence: classification.confidence,
        classificationVersion: KNOWLEDGE_TAXONOMY_VERSION,
        classificationSource: "auto" as const,
      };
    });
    const existing = new Set(
      pointsRef.current.map(knowledgePointIdentity),
    );
    const accepted = created.filter((point) => {
      const key = knowledgePointIdentity(point);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    pointsRef.current = [...pointsRef.current, ...accepted];
    setPoints(pointsRef.current);
    setRecords((current) => ({
      ...current,
      ...Object.fromEntries(accepted.map((point) => [point.id, initialRecord(point.id)])),
    }));
    setError("");
  };

  const deletePoint = (pointId: string) => {
    pointsRef.current = pointsRef.current.filter((point) => point.id !== pointId);
    setPoints(pointsRef.current);
    setRecords((current) => {
      const next = { ...current };
      delete next[pointId];
      return next;
    });
    setAttempts((current) => current.filter((attempt) => attempt.pointId !== pointId));
    const removedQuestionIndexes = questions.flatMap((question, index) =>
      question.pointId === pointId ? [index] : []
    );
    if (removedQuestionIndexes.length) {
      const nextQuestions = questions.filter((question) => question.pointId !== pointId);
      setQuestions(nextQuestions);
      setQuestionIndex((current) => {
        const removedBefore = removedQuestionIndexes.filter(
          (index) => index < current,
        ).length;
        if (removedBefore) return Math.max(0, current - removedBefore);
        return Math.min(current, nextQuestions.length);
      });
      const removedIndexSet = new Set(removedQuestionIndexes);
      setSessionResults((current) =>
        current.filter((_, index) => !removedIndexSet.has(index))
      );
      setAnswer("");
      setChecked(false);
      setLastCorrect(null);
      setPendingGrade(null);
    }
  };

  const beginEditing = (point: KnowledgePoint) => {
    setEditingId(point.id);
    setEditingText(point.text);
  };

  const commitEdit = (pointId: string) => {
    const nextText = editingText.trim();
    if (!nextText) {
      setError("知识点不能为空，已保留原内容。");
      setEditingId(null);
      return;
    }
    pointsRef.current = pointsRef.current.map((point) => {
      if (point.id !== pointId) return point;
      const edited = {
        ...point,
        text: nextText,
        answerParts: point.question
          ? nextText.split(/[；;]/).map((part) => part.trim()).filter(Boolean)
          : point.answerParts,
        subject: undefined,
        knowledgeCategory: undefined,
        classificationConfidence: undefined,
        classificationVersion: undefined,
        classificationSource: undefined,
      };
      const classification = classifyKnowledge(edited);
      return {
        ...edited,
        subject: classification.subject,
        knowledgeCategory: classification.category,
        classificationConfidence: classification.confidence,
        classificationVersion: KNOWLEDGE_TAXONOMY_VERSION,
        classificationSource: "auto" as const,
      };
    });
    setPoints(pointsRef.current);
    setEditingId(null);
  };

  const startQuiz = (source = points) => {
    const validSource = source.filter((point) => point.text.trim());
    if (!validSource.length) {
      setError("请先上传文档或载入示例知识点。");
      setView("library");
      return;
    }
    setQuestions(buildQuestions(validSource));
    setQuestionIndex(0);
    setAnswer("");
    setChecked(false);
    setLastCorrect(null);
    setPendingGrade(null);
    setQuizMode("study");
    setSessionResults([]);
    submitLockRef.current = false;
    gradeCommittedRef.current = false;
    setAdvanceReady(true);
    setView("quiz");
  };

  const openStudyExamSetup = () => {
    setQuestions([]);
    setQuestionIndex(0);
    setAnswer("");
    setChecked(false);
    setLastCorrect(null);
    setPendingGrade(null);
    setQuizMode("study");
    setSessionResults([]);
    submitLockRef.current = false;
    gradeCommittedRef.current = false;
    setAdvanceReady(true);
    setView("quiz");
  };

  const startTodayExam = () => {
    if (!todayQuestionBank.length) {
      setHistoryNotice(
        "当前没有可组卷题目。请导入含题干、选项、答案和解析的今日记录；或开启“加入已上传知识点”。",
      );
      setView("today");
      return;
    }
    const requested = effectiveTodayQuestionCount;
    if (!Number.isFinite(requested) || requested < 1) {
      setHistoryNotice("题目数量至少为 1。");
      return;
    }
    if (requested > todayQuestionBank.length) {
      setHistoryNotice(`当前最多可生成 ${todayQuestionBank.length} 道，请调低题量。`);
      return;
    }
    const selected = selectTodayExamQuestions(
      todayQuestionBank,
      requested,
      `${Date.now()}-${activeTodayItems.length}-${points.length}`,
    );
    setQuestions(selected);
    setQuestionIndex(0);
    setAnswer("");
    setChecked(false);
    setLastCorrect(null);
    setPendingGrade(null);
    setQuizMode("today");
    setSessionResults([]);
    submitLockRef.current = false;
    gradeCommittedRef.current = false;
    setAdvanceReady(true);
    setHistoryNotice("");
    setView("quiz");
  };

  const currentQuestion = questions[questionIndex];
  const currentPoint = currentQuestion
    ? points.find((point) => point.id === currentQuestion.pointId)
    : null;
  const quizComplete = questions.length > 0 && questionIndex >= questions.length;

  const commitGrade = (
    correct: boolean,
    grade: AnswerGrade,
    gradingDecision: Attempt["gradingDecision"] = grade.decision,
  ) => {
    if (!currentQuestion || gradeCommittedRef.current) return;
    gradeCommittedRef.current = true;
    const answeredAt = Date.now();
    setLastCorrect(correct);
    setPendingGrade(null);
    setAdvanceReady(false);
    window.setTimeout(() => setAdvanceReady(true), 360);
    const attempt: Attempt = {
      id: crypto.randomUUID(),
      pointId: currentQuestion.pointId,
      correct,
      answer,
      createdAt: answeredAt,
      questionId: currentQuestion.id,
      sessionKind: quizMode,
      gradingDecision,
      similarity: grade.similarity,
    };
    setAttempts((current) => [attempt, ...current].slice(0, 500));
    setSessionResults((current) => [...current, correct]);
    let shouldTrackReview = pointsRef.current.some(
      (point) => point.id === currentQuestion.pointId,
    );
    if (
      !shouldTrackReview &&
      !correct &&
      quizMode === "today"
    ) {
      const item = currentQuestion.sourceItemId
        ? activeTodayItems.find(
            (candidate) => candidate.id === currentQuestion.sourceItemId,
          )
        : undefined;
      const point = item
        ? learningItemToKnowledgePoint(item, {
            subject: currentQuestion.subject || "其他",
            category:
              currentQuestion.knowledgeCategory ||
              currentQuestion.section ||
              "综合知识",
            confidence: currentQuestion.classificationConfidence || 0.8,
            reasons: ["沿用作答题目的分类"],
          })
        : {
            id: currentQuestion.pointId,
            text: currentQuestion.answer,
            context:
              currentQuestion.explanation ||
              `参考答案：${currentQuestion.answer}`,
            explanation:
              currentQuestion.explanation ||
              `参考答案：${currentQuestion.answer}`,
            question: currentQuestion.stem,
            answerParts: [currentQuestion.answer],
            sourceName: "今日专项卷",
            location: currentQuestion.sourceLabel || "已移除的今日导入记录",
            method: "history-import" as const,
            createdAt: answeredAt,
            subject: currentQuestion.subject,
            knowledgeCategory: currentQuestion.knowledgeCategory,
            classificationConfidence:
              currentQuestion.classificationConfidence,
            classificationVersion: KNOWLEDGE_TAXONOMY_VERSION,
            classificationSource: "auto" as const,
          };
      pointsRef.current = [...pointsRef.current, point];
      setPoints(pointsRef.current);
      shouldTrackReview = true;
    }
    if (shouldTrackReview) {
      setRecords((current) => {
        const record = current[currentQuestion.pointId] || initialRecord(currentQuestion.pointId);
        const canAdvance = record.attempts === 0 || record.nextReviewAt <= answeredAt;
        return {
          ...current,
          [currentQuestion.pointId]: updateRecord(record, correct, answeredAt, canAdvance),
        };
      });
    }
  };

  const submitAnswer = () => {
    if (!currentQuestion || !answer.trim() || checked || submitLockRef.current) return;
    submitLockRef.current = true;
    gradeCommittedRef.current = false;
    const grade = gradeAnswer(answer, currentQuestion);
    setChecked(true);
    if (grade.verdict === "needs-confirmation") {
      setLastCorrect(null);
      setPendingGrade(grade);
      return;
    }
    commitGrade(grade.verdict === "correct", grade);
  };

  const confirmApproximateAnswer = (correct: boolean) => {
    if (!pendingGrade || !currentQuestion) return;
    commitGrade(
      correct,
      pendingGrade,
      correct ? "self-accepted" : "self-rejected",
    );
  };

  const nextQuestion = () => {
    if (!advanceReady || pendingGrade) return;
    submitLockRef.current = false;
    gradeCommittedRef.current = false;
    setQuestionIndex((current) => current + 1);
    setAnswer("");
    setChecked(false);
    setLastCorrect(null);
    setPendingGrade(null);
    setAdvanceReady(true);
  };

  const navItems: Array<{ id: AppView; label: string; count?: number }> = [
    { id: "library", label: "学习台" },
    { id: "today", label: "今日组卷", count: activeTodayItems.length },
    { id: "quiz", label: "开始考察" },
    { id: "review", label: "复习计划", count: duePoints.length },
  ];

  return (
    <>
      {introVisible && <IntroSequence onDone={finishIntro} />}
      <header className="site-header">
        <a className="brand" href="#top" aria-label="忆检首页">
          <span className="brand-mark">忆</span>
          <span>忆检</span>
        </a>
        <nav aria-label="主要导航">
          {navItems.map((item) => (
            <button
              className={view === item.id ? "active" : ""}
              key={item.id}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => {
                if (item.id === "quiz") {
                  if (questions.length && questionIndex < questions.length) {
                    setView("quiz");
                  } else {
                    openStudyExamSetup();
                  }
                }
                else setView(item.id);
              }}
            >
              {item.label}
              {typeof item.count === "number" && item.count > 0 && <em>{item.count}</em>}
            </button>
          ))}
        </nav>
        <div className="privacy-chip"><ShieldCheck size={15} />仅在此设备处理</div>
      </header>

      <main id="top">
        {view === "library" && (
          <>
            <section className="hero-section">
              <div className="eyebrow"><span /> LOCAL-FIRST STUDY SYSTEM</div>
              <h1>把标红的知识，<br /><span>变成下一题。</span></h1>
              <p>上传 PDF 或 DOCX，本地提取红色知识点，自动生成填空与选择题，再按遗忘曲线安排复习。</p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => inputRef.current?.click()}>
                  上传知识文档 <UploadCloud size={18} />
                </button>
                <button className="text-button" onClick={loadDemo}>先体验示例 <ChevronRight size={17} /></button>
              </div>
              <div className="hero-index">01 / EXTRACT · 02 / RECALL · 03 / REVIEW</div>
            </section>

            <section className="workspace-section" aria-label="文档上传与知识点">
              <div className="upload-column">
                <div
                  className={`drop-zone ${dragging ? "dragging" : ""}`}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    acceptFiles(event.dataTransfer.files);
                  }}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf,.docx,.doc"
                    multiple
                    aria-label="选择 PDF 或 DOCX 知识文档"
                    onChange={(event) => event.target.files && acceptFiles(event.target.files)}
                  />
                  <div className="drop-icon"><UploadCloud size={28} /></div>
                  <h2>拖入知识文档</h2>
                  <p>支持电子 PDF、扫描 PDF 与 DOCX；旧版 DOC 请先另存为 DOCX。</p>
                  <button onClick={() => inputRef.current?.click()}>选择文件</button>
                  <div className="local-features">
                    <span><Check size={14} />颜色元数据解析</span>
                    <span><Check size={14} />中英文离线 OCR</span>
                    <span><Check size={14} />文件不上传</span>
                  </div>
                </div>

                {progress && (
                  <div className="progress-card" role="status" aria-live="polite">
                    <div><strong>{progress.label}</strong><span>{progress.percent}%</span></div>
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label={progress.label}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress.percent}
                    ><span style={{ width: `${progress.percent}%` }} /></div>
                    <small>扫描件首次识别会加载本地 OCR 引擎，请保持此页面打开。</small>
                  </div>
                )}
                {error && <div className="error-banner" role="alert"><AlertCircle size={18} /><span>{error}</span><button onClick={() => setError("")} aria-label="关闭提示"><X size={16} /></button></div>}
              </div>

              <aside className="stats-panel">
                <div className="panel-heading"><span>学习概览</span><small>实时保存在本机</small></div>
                <div className="metrics-grid">
                  <Metric label="知识点" value={points.length} detail="已提取" />
                  <Metric label="待复习" value={duePoints.length} detail="当前到期" />
                  <Metric label="正确率" value={`${accuracy}%`} detail={`${attempts.length} 次作答`} />
                  <Metric label="错题" value={wrongPointIds.size} detail="需要巩固" />
                </div>
                <div className="review-preview">
                  <div className="review-preview-icon"><CalendarClock size={22} /></div>
                  <div><strong>下一轮复习</strong><span>{points.length ? nextReviewLabel : "等待知识点"}</span></div>
                  <button onClick={() => setView("review")} aria-label="查看复习计划"><ChevronRight size={17} /></button>
                </div>
              </aside>
            </section>

            <section className="knowledge-section">
              <div className="section-heading">
                <div><span className="section-number">02</span><div><h2>知识点清单</h2><p>检查提取结果；开始前可以编辑或删除。</p></div></div>
                <button className="primary-button compact" disabled={!points.length} onClick={openStudyExamSetup}><Play size={16} />筛选并考察</button>
              </div>

              {points.length ? (
                <div className="knowledge-grid">
                  {points.map((point, index) => {
                    const classification =
                      pointClassifications.get(point.id) || classifyKnowledge(point);
                    return (
                      <article className="knowledge-card" key={point.id}>
                      <div className="knowledge-card-top">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <button onClick={() => editingId === point.id ? commitEdit(point.id) : beginEditing(point)} aria-label="编辑知识点"><Pencil size={15} /></button>
                          <button onClick={() => deletePoint(point.id)} aria-label="删除知识点"><Trash2 size={15} /></button>
                        </div>
                      </div>
                      {editingId === point.id ? (
                        <input
                          aria-label="编辑知识点"
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          onBlur={() => commitEdit(point.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitEdit(point.id);
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                        />
                      ) : <h3>{point.text}</h3>}
                      <div className="knowledge-taxonomy">
                        <span>{classification.subject}</span>
                        <span>{classification.category}</span>
                      </div>
                      <p>{point.context}</p>
                      <footer><span><FileText size={13} />{point.sourceName}</span><span>{point.location}</span></footer>
                    </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <LibraryBig size={32} />
                  <h3>还没有知识点</h3>
                  <p>上传一份带红色文字的文档，或载入示例体验完整流程。</p>
                </div>
              )}
            </section>
          </>
        )}

        {view === "today" && (
          <section className="today-page">
            <div className="today-hero">
              <span className="eyebrow"><span /> TODAY LEARNING · LOCAL EXAM</span>
              <h1>把今天问过的，<br /><span>变成一张选择题卷。</span></h1>
              <p>本地读取你明确选择的 ChatGPT 导出包、Codex JSONL 或粘贴内容，只保留本地时区“今天”的记录。题量由你决定，逐题提交后立即显示答案与解析。</p>
              <div className="today-source-strip" aria-label="今日记录来源统计">
                <span>ChatGPT <strong>{todaySourceCounts.chatgpt}</strong></span>
                <span>Codex <strong>{todaySourceCounts.codex}</strong></span>
                <span>手动 <strong>{todaySourceCounts.manual}</strong></span>
                <span>可组卷 <strong>{todayQuestionBank.length}</strong></span>
              </div>
            </div>

            <div className="today-layout">
              <section className="history-import-panel">
                <div className="section-heading simple">
                  <div>
                    <FileText size={20} />
                    <div>
                      <h2>导入今日学习记录</h2>
                      <p>所有筛选、解析和去重都在当前浏览器完成。</p>
                    </div>
                  </div>
                </div>

                <input
                  ref={historyInputRef}
                  className="visually-hidden"
                  type="file"
                  accept=".zip,.json,.jsonl,.md,.txt"
                  multiple
                  aria-label="选择 ChatGPT 或 Codex 学习记录"
                  onChange={(event) => event.target.files && importHistoryFiles(event.target.files)}
                />
                <div className="history-paths">
                  <article>
                    <span>01 / CHATGPT</span>
                    <strong>导出包或 conversations.json</strong>
                    <p>支持官方数据导出 ZIP；也可以把当前对话按下方模板整理后粘贴。</p>
                  </article>
                  <article>
                    <span>02 / CODEX</span>
                    <strong>当天 rollout JSONL</strong>
                    <p>可运行 <code>npm run history:codex</code> 生成导入文件，或选择 .codex/sessions 中的 JSONL；自动忽略子代理。</p>
                  </article>
                </div>
                <button
                  className="primary-button history-file-button"
                  disabled={historyImporting}
                  onClick={() => historyInputRef.current?.click()}
                >
                  <UploadCloud size={18} />
                  {historyImporting ? "正在本地解析…" : "选择记录文件"}
                </button>

                <div className="history-divider"><span>或粘贴规范 JSON / 对话文本</span></div>
                <textarea
                  className="history-textarea"
                  value={historyText}
                  aria-label="粘贴今日 ChatGPT 或 Codex 学习记录"
                  placeholder={"可粘贴 JSON、Markdown，或“用户：… / 助手：…”对话。\n每道自动评分题必须含题干、选项、答案和解析。"}
                  onChange={(event) => setHistoryText(event.target.value)}
                />
                <div className="history-text-actions">
                  <button
                    className="text-button"
                    onClick={() => setHistoryText(
                      LEARNING_IMPORT_TEMPLATE.replace(
                        /"occurredAt":\s*"[^"]*"/u,
                        `"occurredAt": "${new Date().toISOString()}"`,
                      ),
                    )}
                  >
                    填入格式模板
                  </button>
                  <button
                    className="primary-button compact"
                    disabled={!historyText.trim()}
                    onClick={importHistoryText}
                  >
                    本地解析 <ChevronRight size={16} />
                  </button>
                </div>
                <p className="history-boundary-note">
                  浏览器不会跨站读取你的账号历史；只有你主动选择或粘贴的内容会进入本地题库，文件不会上传。
                </p>
                {historyNotice && (
                  <div className="history-notice" role="status" aria-live="polite">
                    <AlertCircle size={17} />
                    <span>{historyNotice}</span>
                    <button onClick={() => setHistoryNotice("")} aria-label="关闭导入提示">
                      <X size={15} />
                    </button>
                  </div>
                )}
              </section>

              <aside className="exam-config-panel">
                <div className="panel-heading">
                  <span>今日专项卷</span>
                  <small>仅选择题</small>
                </div>
                <div className="exam-ready-number">
                  <strong>{todayQuestionBank.length}</strong>
                  <span>道筛选后可用题目</span>
                </div>
                <label className="document-toggle">
                  <input
                    type="checkbox"
                    checked={includeDocumentPoints}
                    onChange={(event) => setIncludeDocumentPoints(event.target.checked)}
                  />
                  <span>
                    <strong>加入已上传知识点</strong>
                    <small>把 PDF / DOCX 标红内容也转换为四选一题目</small>
                  </span>
                </label>
                <TaxonomyFilter
                  label="今日组卷筛选"
                  subjects={todaySubjects}
                  subject={effectiveTodaySubject}
                  categories={todayCategories}
                  category={effectiveTodayCategory}
                  onSubjectChange={setTodaySubjectFilter}
                  onCategoryChange={setTodayCategoryFilter}
                />
                <label className="question-count-field">
                  <span>本卷题目数量</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, todayQuestionBank.length)}
                    disabled={!todayQuestionBank.length}
                    value={effectiveTodayQuestionCount}
                    onChange={(event) =>
                      setTodayQuestionCount(
                        Number.isFinite(event.currentTarget.valueAsNumber)
                          ? Math.min(
                              Math.max(1, event.currentTarget.valueAsNumber),
                              Math.max(1, todayQuestionBank.length),
                            )
                          : 1,
                      )
                    }
                  />
                </label>
                <div className="count-presets" aria-label="快速选择题量">
                  {[5, 10, 20].map((count) => (
                    <button
                      key={count}
                      disabled={count > todayQuestionBank.length}
                      className={effectiveTodayQuestionCount === count ? "active" : ""}
                      onClick={() => setTodayQuestionCount(count)}
                    >
                      {count} 题
                    </button>
                  ))}
                  <button
                    disabled={!todayQuestionBank.length}
                    className={
                      Boolean(todayQuestionBank.length) &&
                      effectiveTodayQuestionCount === todayQuestionBank.length
                        ? "active"
                        : ""
                    }
                    onClick={() => setTodayQuestionCount(todayQuestionBank.length)}
                  >
                    全部
                  </button>
                </div>
                <p className="exam-spec-note">
                  {effectiveTodaySubject === "大学英语"
                    ? SICHUAN_CHOICE_EXAM_NOTE
                    : effectiveTodaySubject === "all"
                      ? `${SICHUAN_CHOICE_EXAM_NOTE} 其他科目按本地识别的知识大类生成选择题专项训练。`
                      : `${effectiveTodaySubject}按本地识别的知识大类生成选择题专项训练；不宣称等同于该科官方整卷。`}
                </p>
                <button
                  className="primary-button exam-start-button"
                  disabled={!todayQuestionBank.length}
                  onClick={startTodayExam}
                >
                  <Play size={17} />生成并开始作答
                </button>
              </aside>
            </div>

            <section className="today-preview">
              <div className="section-heading">
                <div>
                  <span className="section-number">03</span>
                  <div>
                    <h2>今日记录预览</h2>
                    <p>只有答案与解析完整、且能组成四个唯一选项的记录才进入自动评分。</p>
                  </div>
                </div>
              </div>
              {activeTodayItems.length ? (
                <div className="today-item-list">
                  {activeTodayItems.map((item) => {
                    const eligible = eligibleTodayItemIds.has(item.id);
                    const classification =
                      todayItemClassifications.get(item.id) || classifyKnowledge(item);
                    return (
                      <article className="today-item-row" key={item.id}>
                        <div className={`today-source-mark ${item.source}`}>
                          {item.source === "chatgpt" ? "GPT" : item.source === "codex" ? "CDX" : "TXT"}
                        </div>
                        <div>
                          <div className="today-item-meta">
                            <span>{item.kind === "choice" ? "原题选择题" : "知识点转换题"}</span>
                            <span className="taxonomy-inline">
                              {classification.subject} · {classification.category}
                            </span>
                            <span>{new Date(item.occurredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                            <em className={eligible ? "eligible" : "pending"}>
                              {eligible ? "可组卷" : "待补充干扰项"}
                            </em>
                          </div>
                          <strong>{item.title}</strong>
                          <p>{item.stem}</p>
                          <small>答案：{item.answer} · 解析：{item.explanation}</small>
                        </div>
                        <button onClick={() => removeTodayItem(item.id)} aria-label={`移除 ${item.title}`}>
                          <Trash2 size={16} />
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <Brain size={32} />
                  <h3>今天还没有导入记录</h3>
                  <p>选择 ChatGPT/Codex 记录文件，或粘贴一段包含题干、选项、答案和解析的对话。</p>
                </div>
              )}
            </section>
          </section>
        )}

        {view === "quiz" && (
          <section className="quiz-page">
            {!questions.length ? (
              quizMode === "today" ? (
                <div className="empty-state large">
                  <Brain size={40} />
                  <h2>准备今日专项卷</h2>
                  <p>先导入今天的学习记录，并选择科目、知识大类与题量。</p>
                  <button className="primary-button" onClick={() => setView("today")}>
                    返回今日组卷
                  </button>
                </div>
              ) : (
                <div className="study-exam-setup">
                  <span className="eyebrow"><span /> SUBJECT · KNOWLEDGE · RECALL</span>
                  <h1>先选考察范围，<br /><span>再开始主动回忆。</span></h1>
                  <p>系统已在本机按科目和知识点大类归档。你可以组合筛选，原文和文件都不会上传。</p>
                  <TaxonomyFilter
                    label="考察范围筛选"
                    subjects={studySubjects}
                    subject={effectiveStudySubject}
                    categories={studyCategories}
                    category={effectiveStudyCategory}
                    onSubjectChange={setStudySubjectFilter}
                    onCategoryChange={setStudyCategoryFilter}
                  />
                  <div className="study-exam-ready">
                    <span>当前范围</span>
                    <strong>{filteredStudyPoints.length}</strong>
                    <small>个知识点</small>
                  </div>
                  <div className="study-exam-actions">
                    <button
                      className="primary-button"
                      disabled={!filteredStudyPoints.length}
                      onClick={() => startQuiz(filteredStudyPoints)}
                    >
                      <Play size={17} />开始当前范围考察
                    </button>
                    <button className="text-button" onClick={() => setView("library")}>
                      返回知识点清单 <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
              )
            ) : quizComplete ? (
              <div className="session-summary">
                <div className="summary-icon"><Sparkles size={34} /></div>
                <span className="eyebrow">SESSION COMPLETE</span>
                <h2>{quizMode === "today" ? "今日专项卷完成" : "本轮考察完成"}</h2>
                <div className="session-score">
                  <strong>{sessionCorrect}<span> / {questions.length}</span></strong>
                  <small>正确率 {sessionAccuracy}%</small>
                </div>
                <p>本轮 {questions.length} 道作答已经记录；今日导入记录中的错题会加入复习队列，并在 10 分钟后优先出现。</p>
                <div className="summary-actions">
                  <button className="primary-button" onClick={quizMode === "today" ? startTodayExam : () => startQuiz(filteredStudyPoints)}>
                    <RotateCcw size={17} />再来一轮
                  </button>
                  <button className="text-button" onClick={() => setView("review")}>查看复习计划 <ChevronRight size={17} /></button>
                </div>
              </div>
            ) : currentQuestion && (
              <div className="quiz-shell">
                <div className="quiz-progress-row">
                  <span>
                    {currentQuestion.subject || "其他"} ·{" "}
                    {currentQuestion.knowledgeCategory ||
                      currentQuestion.section ||
                      (currentQuestion.type === "choice" ? "选择题" : "填空题")}
                  </span>
                  <strong>{String(questionIndex + 1).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}</strong>
                </div>
                <div className="quiz-progress"><span style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
                <article className="question-card">
                  <div className="question-kicker">
                    <BookOpen size={16} />
                    {quizMode === "today" ? "今日选择题专项训练" : "根据标红知识点作答"}
                  </div>
                  <h2>{currentQuestion.stem}</h2>
                  {currentQuestion.type === "fill" ? (
                    <input
                      className="answer-input"
                      aria-label="填空题答案"
                      value={answer}
                      disabled={checked}
                      placeholder={
                        (currentQuestion.answerParts?.length || 0) > 1
                          ? "多个空请按题干顺序作答，用分号分隔"
                          : "输入你的答案"
                      }
                      onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        if (checked) nextQuestion();
                        else submitAnswer();
                      }}
                      autoFocus
                    />
                  ) : (
                    <div className="choice-list" role="radiogroup" aria-label="选择答案">
                      {currentQuestion.choices.map((choice, index) => {
                        const chosen = answer === choice;
                        const correctChoice = checked && choice === currentQuestion.answer;
                        const wrongChoice = checked && chosen && choice !== currentQuestion.answer;
                        return (
                          <button
                            className={`${chosen ? "chosen" : ""} ${correctChoice ? "correct" : ""} ${wrongChoice ? "wrong" : ""}`}
                            key={`${currentQuestion.id}-${index}-${choice}`}
                            disabled={checked}
                            aria-pressed={chosen}
                            onClick={() => setAnswer(choice)}
                          >
                            <span>{String.fromCharCode(65 + index)}</span>{choice}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {checked && (
                    <div
                      className={`feedback ${
                        pendingGrade
                          ? "review"
                          : lastCorrect
                            ? "success"
                            : "failure"
                      }`}
                      role="status"
                      aria-live="polite"
                    >
                      <div>
                        {pendingGrade
                          ? <AlertCircle size={20} />
                          : lastCorrect
                            ? <Check size={20} />
                            : <X size={20} />}
                      </div>
                      <div>
                        <strong>
                          {pendingGrade
                            ? "请确认两种表述的大意是否一致"
                            : lastCorrect
                              ? "回答正确"
                              : `正确答案：${currentQuestion.answer}`}
                        </strong>
                        {pendingGrade ? (
                          <>
                            <p>你的答案：{answer}</p>
                            <p>参考答案：{currentQuestion.answer}</p>
                            <p>{pendingGrade.reason}。确认前不会写入成绩或复习计划。</p>
                            <div className="feedback-confirm-actions">
                              <button
                                type="button"
                                onClick={() => confirmApproximateAnswer(true)}
                              >
                                含义相同，算答对
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmApproximateAnswer(false)}
                              >
                                含义不同，算答错
                              </button>
                            </div>
                          </>
                        ) : (
                          <p>{currentQuestion.explanation || currentPoint?.context}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="question-footer">
                    <span>{currentQuestion.sourceLabel || `${currentPoint?.sourceName || ""} · ${currentPoint?.location || ""}`}</span>
                    <button
                      className="primary-button compact"
                      disabled={
                        !answer.trim() ||
                        Boolean(pendingGrade) ||
                        (checked && !advanceReady)
                      }
                      onClick={checked ? nextQuestion : submitAnswer}
                    >
                      {checked ? "下一题" : "提交答案"}<ChevronRight size={17} />
                    </button>
                  </div>
                </article>
              </div>
            )}
          </section>
        )}

        {view === "review" && (
          <section className="review-page">
            <div className="review-hero">
              <span className="eyebrow"><span /> EBBINGHAUS REVIEW</span>
              <h1>在快要忘记之前，<br /><span>再想起一次。</span></h1>
              <p>答错会回到 10 分钟阶段；连续答对后依次延长到 1、2、4、7、15、30 天。</p>
              <button className="primary-button" disabled={!duePoints.length} onClick={() => startQuiz(duePoints)}><Clock3 size={17} />复习到期内容（{duePoints.length}）</button>
            </div>

            <div className="schedule-strip">
              {REVIEW_INTERVALS.map((interval, index) => (
                <div key={interval.label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{interval.label}</strong></div>
              ))}
            </div>

            <div className="review-layout">
              <section className="due-list">
                <div className="section-heading simple"><div><CalendarClock size={20} /><div><h2>复习队列</h2><p>按最近到期时间排列</p></div></div></div>
                {points.length ? points
                  .slice()
                  .sort((a, b) => (records[a.id]?.nextReviewAt || 0) - (records[b.id]?.nextReviewAt || 0))
                  .map((point) => {
                    const record = records[point.id] || initialRecord(point.id);
                    return (
                      <article className="due-row" key={point.id}>
                        <div className={record.nextReviewAt <= now ? "due-dot active" : "due-dot"} />
                        <div>
                          <strong>{point.text}</strong>
                          <span>
                            {pointClassifications.get(point.id)?.subject || "其他"} ·{" "}
                            {pointClassifications.get(point.id)?.category || "综合知识"} ·{" "}
                            {point.sourceName}
                          </span>
                        </div>
                        <div><small>{record.attempts ? `阶段 ${record.stage + 1}` : "未开始"}</small><strong>{formatDue(record.nextReviewAt, now)}</strong></div>
                      </article>
                    );
                  }) : <div className="empty-state compact-empty"><Clock3 size={28} /><p>添加知识点后，复习计划会显示在这里。</p></div>}
              </section>

              <aside className="mistake-panel">
                <div className="panel-heading"><span>错题总结</span><small>{wrongPointIds.size} 个知识点</small></div>
                {wrongPointIds.size ? [...wrongPointIds].map((pointId) => {
                  const point = points.find((item) => item.id === pointId);
                  const record = records[pointId];
                  if (!point) return null;
                  return (
                    <div className="mistake-row" key={pointId}>
                      <div><AlertCircle size={16} /></div>
                      <span>
                        <strong>{point.text}</strong>
                        <small>
                          {pointClassifications.get(point.id)?.subject || "其他"} ·{" "}
                          {pointClassifications.get(point.id)?.category || "综合知识"} ·{" "}
                          累计答错 {record?.wrong || 0} 次 · {formatDue(record?.nextReviewAt || now, now)}
                        </small>
                      </span>
                    </div>
                  );
                }) : <div className="all-clear"><Check size={22} /><strong>暂无错题</strong><span>完成一次考察后，这里会自动汇总。</span></div>}
              </aside>
            </div>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <div><span className="brand-mark">忆</span><strong>忆检</strong></div>
        <p>本地提取 · 主动回忆 · 科学复习</p>
        <span>NO AI EXTRACTION API</span>
      </footer>
    </>
  );
}

export default App;
