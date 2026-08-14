// Ported from cc-switch v3.16.3 claudeProviderPresets.ts (MIT). Keep data-only.
import type { ClaudeProviderConfig } from "../../../shared/events";

export interface ProviderTemplateValue {
  label: string;
  placeholder?: string;
  defaultValue?: string;
}

export interface ClaudeProviderPreset {
  name: string;
  websiteUrl: string;
  apiKeyUrl?: string;
  settingsConfig: ClaudeProviderConfig["settingsConfig"];
  category?: ClaudeProviderConfig["category"];
  isOfficial?: boolean;
  isPartner?: boolean;
  apiKeyField?: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";
  apiFormat?: "anthropic" | "openai_chat" | "openai_responses" | "gemini_native";
  endpointCandidates?: string[];
  templateValues?: Record<string, ProviderTemplateValue>;
  modelsUrl?: string;
  icon?: string;
  iconColor?: string;
}

export const claudeProviderPresets: ClaudeProviderPreset[] = [
  {
    name: "Claude Official",
    websiteUrl: "https://www.anthropic.com/claude-code",
    settingsConfig: {
      env: {},
    },
    isOfficial: true,
    category: "official",
    icon: "anthropic",
    iconColor: "#D4915D",
  },
  {
    name: "胜算云",
    websiteUrl: "https://www.shengsuanyun.com/?from=CH_4HHXMRYF",
    apiKeyUrl: "https://www.shengsuanyun.com/?from=CH_4HHXMRYF",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://router.shengsuanyun.com/api",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.8",
      },
    },
    category: "aggregator",
    isPartner: true,
    icon: "shengsuanyun",
  },
  {
    name: "PatewayAI",
    websiteUrl: "https://pateway.ai",
    apiKeyUrl: "https://pateway.ai/?ch=etzpm8&aff=WB6M6F67#/",
    apiKeyField: "ANTHROPIC_API_KEY",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.pateway.ai",
        ANTHROPIC_API_KEY: "",
      },
    },
    category: "third_party",
    isPartner: true,
    icon: "pateway",
  },
  {
    name: "火山Agentplan",
    websiteUrl:
      "https://www.volcengine.com/activity/codingplan?ac=MMAP8JTTCAQ2&rc=6J6FV5N2&utm_campaign=hw&utm_content=ccswitch&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ccswitch",
    apiKeyUrl:
      "https://www.volcengine.com/activity/codingplan?ac=MMAP8JTTCAQ2&rc=6J6FV5N2&utm_campaign=hw&utm_content=ccswitch&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ccswitch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://ark.cn-beijing.volces.com/api/coding",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "ark-code-latest",
      },
    },
    category: "cn_official",
    isPartner: true,
    icon: "huoshan",
    iconColor: "#3370FF",
  },
  {
    name: "BytePlus",
    websiteUrl:
      "https://www.byteplus.com/en/product/modelark?utm_campaign=hw&utm_content=ccswitch&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ccswitch",
    apiKeyUrl:
      "https://www.byteplus.com/en/product/modelark?utm_campaign=hw&utm_content=ccswitch&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ccswitch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/coding",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "ark-code-latest",
      },
    },
    category: "cn_official",
    isPartner: true,
    icon: "byteplus",
    iconColor: "#3370FF",
  },
  {
    name: "DouBaoSeed",
    websiteUrl:
      "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D&utm_campaign=hw&utm_content=ccswitch&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ccswitch",
    apiKeyUrl:
      "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D&utm_campaign=hw&utm_content=ccswitch&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ccswitch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://ark.cn-beijing.volces.com/api/compatible",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "3000000",
        ANTHROPIC_MODEL: "doubao-seed-2-0-code-preview-latest",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "doubao-seed-2-0-code-preview-latest",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "doubao-seed-2-0-code-preview-latest",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "doubao-seed-2-0-code-preview-latest",
      },
    },
    category: "cn_official",
    isPartner: true,
    icon: "doubao",
    iconColor: "#3370FF",
  },
  {
    name: "CCSub",
    websiteUrl: "https://www.ccsub.net",
    apiKeyUrl: "https://www.ccsub.net/register?ref=Y6Z8DXEA",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://www.ccsub.net",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "aggregator",
    isPartner: true,
    icon: "ccsub",
  },
  {
    name: "Unity2.ai",
    websiteUrl: "https://unity2.ai",
    apiKeyUrl: "https://unity2.ai/register?source=ccs",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.unity2.ai",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "aggregator",
    isPartner: true,
    icon: "unity2",
  },
  {
    name: "Gemini Native",
    websiteUrl: "https://ai.google.dev/gemini-api",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    apiKeyField: "ANTHROPIC_API_KEY",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://generativelanguage.googleapis.com",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_MODEL: "gemini-3.5-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "gemini-3.5-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "gemini-3.5-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "gemini-3.5-flash",
      },
    },
    category: "third_party",
    apiFormat: "gemini_native",
    endpointCandidates: ["https://generativelanguage.googleapis.com"],
    icon: "gemini",
    iconColor: "#4285F4",
  },
  {
    name: "DeepSeek",
    websiteUrl: "https://platform.deepseek.com",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
      },
    },
    category: "cn_official",
    modelsUrl: "https://api.deepseek.com/models",
    icon: "deepseek",
    iconColor: "#1E88E5",
  },
  {
    name: "OpenCode Go",
    websiteUrl: "https://opencode.ai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://opencode.ai/zen/go",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-flash",
      },
    },
    category: "third_party",
    apiFormat: "openai_chat",
    endpointCandidates: ["https://opencode.ai/zen/go"],
    icon: "opencode",
    iconColor: "#211E1E",
  },
  {
    name: "Zhipu GLM",
    websiteUrl: "https://open.bigmodel.cn",
    apiKeyUrl: "https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
      },
    },
    category: "cn_official",
    icon: "zhipu",
    iconColor: "#0F62FE",
  },
  {
    name: "Zhipu GLM en",
    websiteUrl: "https://z.ai",
    apiKeyUrl: "https://z.ai/subscribe?ic=8JVLJQFSKB",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
      },
    },
    category: "cn_official",
    icon: "zhipu",
    iconColor: "#0F62FE",
  },
  {
    name: "Baidu Qianfan Coding Plan",
    websiteUrl: "https://cloud.baidu.com/product/qianfan_modelbuilder",
    apiKeyUrl:
      "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://qianfan.baidubce.com/anthropic/coding",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "qianfan-code-latest",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "qianfan-code-latest",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "qianfan-code-latest",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "qianfan-code-latest",
      },
    },
    category: "cn_official",
    endpointCandidates: ["https://qianfan.baidubce.com/anthropic/coding"],
    icon: "baidu",
    iconColor: "#2932E1",
  },
  {
    name: "Bailian",
    websiteUrl: "https://bailian.console.aliyun.com",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "cn_official",
    icon: "bailian",
    iconColor: "#624AFF",
  },
  {
    name: "Bailian For Coding",
    websiteUrl: "https://bailian.console.aliyun.com",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "cn_official",
    icon: "bailian",
    iconColor: "#624AFF",
  },
  {
    name: "Kimi",
    websiteUrl: "https://platform.moonshot.cn/console?aff=cc-switch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.moonshot.cn/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "kimi-k2.7-code",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k2.7-code",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2.7-code",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k2.7-code",
      },
    },
    category: "cn_official",
    icon: "kimi",
    iconColor: "#6366F1",
  },
  {
    name: "Kimi For Coding",
    websiteUrl: "https://www.kimi.com/code/docs/?aff=cc-switch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "cn_official",
    icon: "kimi",
    iconColor: "#6366F1",
  },
  {
    name: "StepFun",
    websiteUrl: "https://platform.stepfun.com/step-plan",
    apiKeyUrl: "https://platform.stepfun.com/interface-key",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.stepfun.com/step_plan",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "step-3.5-flash-2603",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "step-3.5-flash-2603",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "step-3.5-flash-2603",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "step-3.5-flash-2603",
      },
    },
    category: "cn_official",
    endpointCandidates: ["https://api.stepfun.com/step_plan"],
    icon: "stepfun",
    iconColor: "#16D6D2",
  },
  {
    name: "StepFun en",
    websiteUrl: "https://platform.stepfun.ai/step-plan",
    apiKeyUrl: "https://platform.stepfun.ai/interface-key",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.stepfun.ai/step_plan",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "step-3.5-flash-2603",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "step-3.5-flash-2603",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "step-3.5-flash-2603",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "step-3.5-flash-2603",
      },
    },
    category: "cn_official",
    endpointCandidates: ["https://api.stepfun.ai/step_plan"],
    icon: "stepfun",
    iconColor: "#16D6D2",
  },
  {
    name: "ModelScope",
    websiteUrl: "https://modelscope.cn",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api-inference.modelscope.cn",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "ZhipuAI/GLM-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "ZhipuAI/GLM-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "ZhipuAI/GLM-5.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "ZhipuAI/GLM-5.1",
      },
    },
    category: "aggregator",
    icon: "modelscope",
    iconColor: "#624AFF",
  },
  {
    name: "KAT-Coder",
    websiteUrl: "https://console.streamlake.ai",
    apiKeyUrl: "https://console.streamlake.ai/console/api-key",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL:
          "https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "KAT-Coder-Pro V1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "KAT-Coder-Air V1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "KAT-Coder-Pro V1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "KAT-Coder-Pro V1",
      },
    },
    category: "cn_official",
    templateValues: {
      ENDPOINT_ID: {
        label: "Vanchin Endpoint ID",
        placeholder: "ep-xxx-xxx",
        defaultValue: "",
      },
    },
    icon: "catcoder",
  },
  {
    name: "Longcat",
    websiteUrl: "https://longcat.chat/platform",
    apiKeyUrl: "https://longcat.chat/platform/api_keys",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.longcat.chat/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "LongCat-Flash-Chat",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "LongCat-Flash-Chat",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "LongCat-Flash-Chat",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "LongCat-Flash-Chat",
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: "6000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
    category: "cn_official",
    icon: "longcat",
    iconColor: "#29E154",
  },
  {
    name: "MiniMax",
    websiteUrl: "https://platform.minimaxi.com",
    apiKeyUrl: "https://platform.minimaxi.com/subscribe/coding-plan",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "3000000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ANTHROPIC_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
      },
    },
    category: "cn_official",
    icon: "minimax",
    iconColor: "#FF6B6B",
  },
  {
    name: "MiniMax en",
    websiteUrl: "https://platform.minimax.io",
    apiKeyUrl: "https://platform.minimax.io/subscribe/coding-plan",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "3000000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ANTHROPIC_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
      },
    },
    category: "cn_official",
    icon: "minimax",
    iconColor: "#FF6B6B",
  },
  {
    name: "BaiLing",
    websiteUrl: "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.tbox.cn/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "Ling-2.5-1T",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "Ling-2.5-1T",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "Ling-2.5-1T",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "Ling-2.5-1T",
      },
    },
    category: "cn_official",
  },
  {
    name: "AiHubMix",
    websiteUrl: "https://aihubmix.com",
    apiKeyUrl: "https://aihubmix.com",
    apiKeyField: "ANTHROPIC_API_KEY",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://aihubmix.com",
        ANTHROPIC_API_KEY: "",
      },
    },
    endpointCandidates: ["https://aihubmix.com", "https://api.aihubmix.com"],
    category: "aggregator",
    icon: "aihubmix",
    iconColor: "#006FFB",
  },
  {
    name: "CherryIN",
    websiteUrl: "https://open.cherryin.ai",
    apiKeyUrl: "https://open.cherryin.ai/console/token",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://open.cherryin.net",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.8",
      },
    },
    category: "aggregator",
    endpointCandidates: ["https://open.cherryin.net"],
    icon: "cherryin",
  },
  {
    name: "SiliconFlow",
    websiteUrl: "https://siliconflow.cn",
    apiKeyUrl: "https://cloud.siliconflow.cn/i/drGuwc9k",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.siliconflow.cn",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
      },
    },
    category: "aggregator",
    isPartner: true,
    icon: "siliconflow",
    iconColor: "#6E29F6",
  },
  {
    name: "SiliconFlow en",
    websiteUrl: "https://siliconflow.com",
    apiKeyUrl: "https://cloud.siliconflow.cn/i/drGuwc9k",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.siliconflow.com",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMaxAI/MiniMax-M2.7",
      },
    },
    category: "aggregator",
    isPartner: true,
    icon: "siliconflow",
    iconColor: "#000000",
  },
  {
    name: "DMXAPI",
    websiteUrl: "https://www.dmxapi.cn",
    apiKeyUrl: "https://www.dmxapi.cn",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://www.dmxapi.cn",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: ["https://www.dmxapi.cn", "https://api.dmxapi.cn"],
    category: "aggregator",
    isPartner: true,
  },
  {
    name: "PackyCode",
    websiteUrl: "https://www.packyapi.com",
    apiKeyUrl: "https://www.packyapi.com/register?aff=cc-switch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://www.packyapi.com",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: [
      "https://www.packyapi.com",
      "https://api-slb.packyapi.com",
    ],
    category: "third_party",
    isPartner: true,
    icon: "packycode",
  },
  {
    name: "APIKEY.FUN",
    websiteUrl: "https://apikey.fun",
    apiKeyUrl: "https://apikey.fun/register?aff=CCSwitch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.apikey.fun",
        ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
    endpointCandidates: ["https://api.apikey.fun", "https://slb.apikey.fun"],
    category: "third_party",
    isPartner: true,
    icon: "apikeyfun",
  },
  {
    name: "APINebula",
    websiteUrl: "https://apinebula.com",
    apiKeyUrl: "https://apinebula.com/02rw5X",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://apinebula.com",
        ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
    endpointCandidates: ["https://apinebula.com"],
    category: "third_party",
    isPartner: true,
    icon: "apinebula",
  },
  {
    name: "AtlasCloud",
    websiteUrl: "https://www.atlascloud.ai/console/coding-plan",
    apiKeyUrl: "https://www.atlascloud.ai/console/coding-plan",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.atlascloud.ai",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "zai-org/glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "zai-org/glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "zai-org/glm-5.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "zai-org/glm-5.1",
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
      },
    },
    endpointCandidates: ["https://api.atlascloud.ai"],
    category: "aggregator",
    isPartner: true,
    icon: "atlascloud",
  },
  {
    name: "SudoCode",
    websiteUrl: "https://sudocode.us",
    apiKeyUrl: "https://sudocode.us",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://sudocode.us",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "300000",
      },
    },
    endpointCandidates: ["https://sudocode.us", "https://sudocode.run"],
    category: "third_party",
    icon: "sudocode",
  },
  {
    name: "ClaudeAPI",
    websiteUrl: "https://claudeapi.com",
    apiKeyUrl: "https://console.claudeapi.com/register?aff=pCLD",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://gw.claudeapi.com",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "aggregator",
    isPartner: true,
    icon: "claudeapi",
  },
  {
    name: "ClaudeCN",
    websiteUrl: "https://claudecn.top",
    apiKeyUrl: "https://claudecn.top/register?aff=ccswitch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://claudecn.top",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "third_party",
    isPartner: true,
    icon: "claudecn",
  },
  {
    name: "RunAPI",
    websiteUrl: "https://runapi.co",
    apiKeyUrl: "https://runapi.co",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://runapi.co",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "aggregator",
    isPartner: true,
    icon: "runapi",
  },
  {
    name: "RelaxyCode",
    websiteUrl: "https://www.relaxycode.com",
    apiKeyUrl: "https://www.relaxycode.com/register",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://www.relaxycode.com",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "third_party",
    icon: "relaxcode",
  },
  {
    name: "Cubence",
    websiteUrl: "https://cubence.com",
    apiKeyUrl: "https://cubence.com/signup?code=CCSWITCH&source=ccs",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.cubence.com",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: [
      "https://api.cubence.com",
      "https://api-cf.cubence.com",
      "https://api-dmit.cubence.com",
      "https://api-bwg.cubence.com",
    ],
    category: "third_party",
    isPartner: true,
    icon: "cubence",
    iconColor: "#000000",
  },
  {
    name: "AIGoCode",
    websiteUrl: "https://aigocode.com",
    apiKeyUrl: "https://aigocode.com/invite/CC-SWITCH",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.aigocode.com",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: ["https://api.aigocode.com"],
    category: "third_party",
    isPartner: true,
    icon: "aigocode",
    iconColor: "#5B7FFF",
  },
  {
    name: "RightCode",
    websiteUrl: "https://www.right.codes",
    apiKeyUrl: "https://www.right.codes/register?aff=CCSWITCH",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://www.right.codes/claude",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "third_party",
    isPartner: true,
    icon: "rc",
    iconColor: "#E96B2C",
  },
  {
    name: "AICodeMirror",
    websiteUrl: "https://www.aicodemirror.com",
    apiKeyUrl: "https://www.aicodemirror.com/register?invitecode=9915W3",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.aicodemirror.com/api/claudecode",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: [
      "https://api.aicodemirror.com/api/claudecode",
      "https://api.claudecode.net.cn/api/claudecode",
    ],
    category: "third_party",
    isPartner: true,
    icon: "aicodemirror",
    iconColor: "#000000",
  },
  {
    name: "CrazyRouter",
    websiteUrl: "https://www.crazyrouter.com",
    apiKeyUrl: "https://www.crazyrouter.com/register?aff=OZcm&ref=cc-switch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://cn.crazyrouter.com",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: ["https://cn.crazyrouter.com"],
    category: "third_party",
    isPartner: true,
    icon: "crazyrouter",
    iconColor: "#000000",
  },
  {
    name: "SSSAiCode",
    websiteUrl: "https://sssaicodeapi.com",
    apiKeyUrl: "https://sssaicodeapi.com/register?ref=DCP0SM",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://node-hk.sssaicodeapi.com/api",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: [
      "https://node-hk.sssaicodeapi.com/api",
      "https://node-hk.sssaiapi.com/api",
      "https://node-cf.sssaicodeapi.com/api",
    ],
    category: "third_party",
    isPartner: true,
    icon: "sssaicode",
    iconColor: "#000000",
  },
  {
    name: "优云智算",
    websiteUrl: "https://www.compshare.cn",
    apiKeyUrl: "https://www.compshare.cn/coding-plan?ytag=GPU_YY_YX_git_cc-switch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.modelverse.cn",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: ["https://api.modelverse.cn"],
    category: "aggregator",
    isPartner: true,
    icon: "ucloud",
    iconColor: "#000000",
  },
  {
    name: "优云智算Coding Plan",
    websiteUrl: "https://www.compshare.cn",
    apiKeyUrl: "https://www.compshare.cn/coding-plan?ytag=GPU_YY_YX_git_cc-switch",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://cp.compshare.cn",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: ["https://cp.compshare.cn"],
    category: "aggregator",
    isPartner: true,
    icon: "ucloud",
    iconColor: "#000000",
  },
  {
    name: "Micu",
    websiteUrl: "https://www.micuapi.ai",
    apiKeyUrl: "https://www.micuapi.ai/register?aff=aOYQ",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://www.micuapi.ai",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    endpointCandidates: ["https://www.micuapi.ai"],
    category: "third_party",
    isPartner: true,
    icon: "micu",
    iconColor: "#000000",
  },
  {
    name: "CTok.ai",
    websiteUrl: "https://ctok.ai",
    apiKeyUrl: "https://ctok.ai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.ctok.ai",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
    category: "third_party",
    isPartner: true,
    icon: "ctok",
    iconColor: "#000000",
  },
  {
    name: "E-FlowCode",
    websiteUrl: "https://e-flowcode.cc",
    apiKeyUrl: "https://e-flowcode.cc",
    settingsConfig: {
      effortLevel: "high",
      env: {
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_BASE_URL: "https://e-flowcode.cc",
      },
      enabledPlugins: {
        "superpowers@superpowers-marketplace": true,
      },
      includeCoAuthoredBy: false,
      ENABLE_TOOL_SEARCH: true,
      skipWebFetchPreflight: true,
    },
    category: "third_party",
    endpointCandidates: ["https://e-flowcode.cc"],
    icon: "eflowcode",
    iconColor: "#000000",
  },
  {
    name: "OpenRouter",
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.8",
      },
    },
    category: "aggregator",
    icon: "openrouter",
    iconColor: "#6566F1",
  },
  {
    name: "TheRouter",
    websiteUrl: "https://therouter.ai",
    apiKeyUrl: "https://dashboard.therouter.ai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.therouter.ai",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.8",
      },
    },
    category: "aggregator",
    endpointCandidates: ["https://api.therouter.ai"],
  },
  {
    name: "Novita AI",
    websiteUrl: "https://novita.ai",
    apiKeyUrl: "https://novita.ai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.novita.ai/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "zai-org/glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "zai-org/glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "zai-org/glm-5.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "zai-org/glm-5.1",
      },
    },
    category: "aggregator",
    endpointCandidates: ["https://api.novita.ai/anthropic"],
    icon: "novita",
    iconColor: "#000000",
  },
  {
    name: "Nvidia",
    websiteUrl: "https://build.nvidia.com",
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://integrate.api.nvidia.com",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "moonshotai/kimi-k2.5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "moonshotai/kimi-k2.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "moonshotai/kimi-k2.5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "moonshotai/kimi-k2.5",
      },
    },
    category: "aggregator",
    apiFormat: "openai_chat",
    icon: "nvidia",
    iconColor: "#000000",
  },
  {
    name: "PIPELLM",
    websiteUrl: "https://code.pipellm.ai",
    apiKeyUrl: "https://code.pipellm.ai/login?ref=uvw650za",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://cc-api.pipellm.ai",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "claude-opus-4-8",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5-20251001",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
      },
      includeCoAuthoredBy: false,
    },
    category: "aggregator",
    icon: "pipellm",
  },
  {
    name: "Xiaomi MiMo",
    websiteUrl: "https://platform.xiaomimimo.com",
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/api-keys",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.xiaomimimo.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
      },
    },
    category: "cn_official",
    icon: "xiaomimimo",
    iconColor: "#000000",
  },
  {
    name: "Xiaomi MiMo Token Plan (China)",
    websiteUrl: "https://platform.xiaomimimo.com/#/token-plan",
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/plan-manage",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://token-plan-cn.xiaomimimo.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
      },
    },
    category: "cn_official",
    icon: "xiaomimimo",
    iconColor: "#000000",
  },
  {
    name: "AWS Bedrock (AKSK)",
    websiteUrl: "https://aws.amazon.com/bedrock/",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://bedrock-runtime.${AWS_REGION}.amazonaws.com",
        AWS_ACCESS_KEY_ID: "${AWS_ACCESS_KEY_ID}",
        AWS_SECRET_ACCESS_KEY: "${AWS_SECRET_ACCESS_KEY}",
        AWS_REGION: "${AWS_REGION}",
        ANTHROPIC_MODEL: "global.anthropic.claude-opus-4-8",
        ANTHROPIC_DEFAULT_HAIKU_MODEL:
          "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "global.anthropic.claude-sonnet-4-6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "global.anthropic.claude-opus-4-8",
        CLAUDE_CODE_USE_BEDROCK: "1",
      },
    },
    category: "cloud_provider",
    templateValues: {
      AWS_REGION: {
        label: "AWS Region",
        placeholder: "us-west-2",
      },
      AWS_ACCESS_KEY_ID: {
        label: "Access Key ID",
        placeholder: "AKIA...",
      },
      AWS_SECRET_ACCESS_KEY: {
        label: "Secret Access Key",
        placeholder: "your-secret-key",
      },
    },
    icon: "aws",
    iconColor: "#FF9900",
  },
  {
    name: "AWS Bedrock (API Key)",
    websiteUrl: "https://aws.amazon.com/bedrock/",
    settingsConfig: {
      apiKey: "",
      env: {
        ANTHROPIC_BASE_URL: "https://bedrock-runtime.${AWS_REGION}.amazonaws.com",
        AWS_REGION: "${AWS_REGION}",
        ANTHROPIC_MODEL: "global.anthropic.claude-opus-4-8",
        ANTHROPIC_DEFAULT_HAIKU_MODEL:
          "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "global.anthropic.claude-sonnet-4-6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "global.anthropic.claude-opus-4-8",
        CLAUDE_CODE_USE_BEDROCK: "1",
      },
    },
    category: "cloud_provider",
    templateValues: {
      AWS_REGION: {
        label: "AWS Region",
        placeholder: "us-west-2",
      },
    },
    icon: "aws",
    iconColor: "#FF9900",
  },
];
