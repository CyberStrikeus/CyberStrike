/**
 * * Configuration of the i18n system data files and text translations
 */

/**
 * * Data file configuration for the i18n system
 * Every {Data} key must exist in the below object
 */
import navDataEn from "./en/navData.json";
import sidebarNavDataEn from "./en/sidebarNavData.json";
import siteDataEn from "./en/siteData.json";
import testimonialDataEn from "./en/testimonialData.json";
import navDataFr from "./fr/navData.json";
import sidebarNavDataFr from "./fr/sidebarNavData.json";
import siteDataFr from "./fr/siteData.json";
import testimonialDataFr from "./fr/testimonialData.json";
import navDataZh from "./zh/navData.json";
import sidebarNavDataZh from "./zh/sidebarNavData.json";
import siteDataZh from "./zh/siteData.json";
import testimonialDataZh from "./zh/testimonialData.json";
import navDataJa from "./ja/navData.json";
import sidebarNavDataJa from "./ja/sidebarNavData.json";
import siteDataJa from "./ja/siteData.json";
import testimonialDataJa from "./ja/testimonialData.json";
import navDataRu from "./ru/navData.json";
import sidebarNavDataRu from "./ru/sidebarNavData.json";
import siteDataRu from "./ru/siteData.json";
import testimonialDataRu from "./ru/testimonialData.json";
import navDataHi from "./hi/navData.json";
import sidebarNavDataHi from "./hi/sidebarNavData.json";
import siteDataHi from "./hi/siteData.json";
import testimonialDataHi from "./hi/testimonialData.json";
import navDataKo from "./ko/navData.json";
import sidebarNavDataKo from "./ko/sidebarNavData.json";
import siteDataKo from "./ko/siteData.json";
import testimonialDataKo from "./ko/testimonialData.json";
import navDataDe from "./de/navData.json";
import sidebarNavDataDe from "./de/sidebarNavData.json";
import siteDataDe from "./de/siteData.json";
import testimonialDataDe from "./de/testimonialData.json";
import navDataPt from "./pt/navData.json";
import sidebarNavDataPt from "./pt/sidebarNavData.json";
import siteDataPt from "./pt/siteData.json";
import testimonialDataPt from "./pt/testimonialData.json";

export const dataTranslations = {
  en: {
    siteData: siteDataEn,
    navData: navDataEn,
    sidebarNavData: sidebarNavDataEn,
    testimonialData: testimonialDataEn,
  },
  fr: {
    siteData: siteDataFr,
    navData: navDataFr,
    sidebarNavData: sidebarNavDataFr,
    testimonialData: testimonialDataFr,
  },
  zh: {
    siteData: siteDataZh,
    navData: navDataZh,
    sidebarNavData: sidebarNavDataZh,
    testimonialData: testimonialDataZh,
  },
  ja: {
    siteData: siteDataJa,
    navData: navDataJa,
    sidebarNavData: sidebarNavDataJa,
    testimonialData: testimonialDataJa,
  },
  ru: {
    siteData: siteDataRu,
    navData: navDataRu,
    sidebarNavData: sidebarNavDataRu,
    testimonialData: testimonialDataRu,
  },
  hi: {
    siteData: siteDataHi,
    navData: navDataHi,
    sidebarNavData: sidebarNavDataHi,
    testimonialData: testimonialDataHi,
  },
  ko: {
    siteData: siteDataKo,
    navData: navDataKo,
    sidebarNavData: sidebarNavDataKo,
    testimonialData: testimonialDataKo,
  },
  de: {
    siteData: siteDataDe,
    navData: navDataDe,
    sidebarNavData: sidebarNavDataDe,
    testimonialData: testimonialDataDe,
  },
  pt: {
    siteData: siteDataPt,
    navData: navDataPt,
    sidebarNavData: sidebarNavDataPt,
    testimonialData: testimonialDataPt,
  },
} as const;

/**
 * * Text translations are used with the `useTranslation` function from src/js/i18nUtils.ts to translate various strings on your site.
 */
export const textTranslations = {
  en: {
    hero_description: `The open-source AI agent for penetration testing. Automate reconnaissance, vulnerability scanning, and exploitation with intelligent security agents powered by leading LLMs.`,
    back_to_all_posts: "Back to all posts",
  },
  fr: {
    hero_description:
      "L'agent IA open-source pour les tests de pénétration. Automatisez la reconnaissance, l'analyse des vulnérabilités et l'exploitation avec des agents de sécurité intelligents.",
    back_to_all_posts: "Retour à tous les articles",
  },
  zh: {
    hero_description:
      "开源 AI 渗透测试工具。使用由领先 LLM 驱动的智能安全代理，自动化侦察、漏洞扫描和渗透利用。",
    back_to_all_posts: "返回所有文章",
  },
  ja: {
    hero_description:
      "オープンソースのAIペネトレーションテストツール。主要なLLMを活用したインテリジェントなセキュリティエージェントで、偵察、脆弱性スキャン、エクスプロイトを自動化します。",
    back_to_all_posts: "すべての記事に戻る",
  },
  ru: {
    hero_description:
      "Открытый ИИ-агент для тестирования на проникновение. Автоматизируйте разведку, сканирование уязвимостей и эксплуатацию с помощью интеллектуальных агентов безопасности на базе ведущих LLM.",
    back_to_all_posts: "Вернуться ко всем статьям",
  },
  hi: {
    hero_description:
      "पेनेट्रेशन टेस्टिंग के लिए ओपन-सोर्स AI एजेंट। प्रमुख LLM द्वारा संचालित बुद्धिमान सुरक्षा एजेंटों के साथ टोही, भेद्यता स्कैनिंग और शोषण को स्वचालित करें।",
    back_to_all_posts: "सभी पोस्ट पर वापस जाएँ",
  },
  ko: {
    hero_description:
      "오픈소스 AI 침투 테스트 도구. 주요 LLM 기반 지능형 보안 에이전트로 정찰, 취약점 스캔, 익스플로잇을 자동화합니다.",
    back_to_all_posts: "모든 게시물로 돌아가기",
  },
  de: {
    hero_description:
      "Der Open-Source-KI-Agent für Penetrationstests. Automatisieren Sie Aufklärung, Schwachstellen-Scanning und Exploitation mit intelligenten Sicherheitsagenten, die von führenden LLMs angetrieben werden.",
    back_to_all_posts: "Zurück zu allen Beiträgen",
  },
  pt: {
    hero_description:
      "O agente de IA open-source para testes de penetração. Automatize reconhecimento, varredura de vulnerabilidades e exploração com agentes de segurança inteligentes alimentados por LLMs líderes.",
    back_to_all_posts: "Voltar a todos os artigos",
  },
} as const;

/**
 * * Route translations are used to translate route names for the language switcher component
 */
export const routeTranslations = {
  en: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
  fr: {
    overviewKey: "apercu",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
  zh: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
  ja: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
  ru: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
  hi: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
  ko: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
  de: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
  pt: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
  },
} as const;

/**
 * * Content collection translations used by the language switcher and hreflang generator
 */
export const localizedCollections = {
  docs: {
    en: "docs",
    fr: "docs",
    zh: "docs",
    ja: "docs",
    ru: "docs",
    hi: "docs",
    ko: "docs",
    de: "docs",
    pt: "docs",
  },
} as const;
