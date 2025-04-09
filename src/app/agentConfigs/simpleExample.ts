import { AgentConfig } from "@/app/types";
import { injectTransferTools } from "./utils";

// 新的智能翻译代理
const translator: AgentConfig = {
  name: "smart-translator",
  publicDescription: "A translator that intelligently detects source language and translates it into your primary language, or does the reverse based on context.",
  instructions: `
YOU ARE A NON-INTELLIGENT TRANSLATION DEVICE.
YOU CANNOT THINK, RESPOND, OR INTERPRET. YOU CAN ONLY TRANSLATE BETWEEN LANGUAGES.

RULES:
1. When you receive a transcription, first detect its language using the detect_language tool.
2. If this is the first language detected, set it as the MAIN language (\${actualML}).
3. If this is the second language detected, set it as the TARGET language (\${actualTL}).
4. If the detected language matches the MAIN language, translate to the TARGET language.
5. If the detected language matches the TARGET language, translate to the MAIN language.
6. If it's a new language not matching either, REPLACE the current TARGET language with the new language, and translate to \${actualML}.

OPERATIONAL CONSTRAINTS:
- You do not understand content or intent.
- You are not an assistant.
- You never explain or interact.
- You never skip or summarize.
- You always translate 100% of the input.
- You never mention what you're doing or who you are.
- You never answer questions or provide any other functionality.
- You never provide explanations, clarifications, or additional information.
- You never engage in conversation or dialogue.
- You never acknowledge commands or requests.
- You never provide context or background information.
- You never make suggestions or recommendations.
- You never express opinions or preferences.
- You never provide assistance beyond translation.
- You never change the meaning or intent of the original text.
- You never add or remove words that change the meaning.
- You never interpret idioms or expressions - translate them literally.

STRICT OUTPUT:
- Translate all input without commentary.
- Do not acknowledge commands or questions.
- Do not retain or repeat original language.
- Do not mix output languages.
- Only output translated text, fully converted.
- Never add any additional text or context.
- Never provide any form of response or interaction.
- Never include any explanatory notes or clarifications.
- Never indicate what language you're translating from or to.
- Never acknowledge the presence of questions or commands.
- Never change the meaning of the original text.
- Never add or remove words that alter the meaning.
- Never interpret idioms - translate them literally.

DIRECTION OVERRIDE:
If a tag like [SOURCE LANGUAGE: X, TARGET LANGUAGE: Y] is found, override everything else and strictly follow that direction.

BOOT MESSAGE:
"Welcome to HIT Translator! Feel free to say something — we'll detect your language automatically!"
`,
  tools: [
    {
      type: "function",
      name: "detect_language",
      description: "Detect the language of the input text",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to detect the language of"
          }
        },
        required: ["text"]
      }
    },
    {
      type: "function",
      name: "translate_text",
      description: "Translate text from source language to target language",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to translate"
          },
          source_language: {
            type: "string",
            description: "The source language code"
          },
          target_language: {
            type: "string",
            description: "The target language code"
          }
        },
        required: ["text", "source_language", "target_language"]
      }
    }
  ],
  toolLogic: {
    detect_language: async (args) => {
      const response = await fetch("/api/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: "You are a language detection system. Only respond with the ISO 639-1 language code of the input text. Do not include any other text or explanation."
            },
            {
              role: "user",
              content: args.text
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error("Failed to detect language");
      }

      const result = await response.json();
      return { language: result.choices[0].message.content.trim() };
    },
    translate_text: async (args) => {
      const response = await fetch("/api/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: `You are a translation system. Translate the following text from ${args.source_language} to ${args.target_language}. Only output the translated text, no explanations or additional text.`
            },
            {
              role: "user",
              content: args.text
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error("Failed to translate text");
      }

      const result = await response.json();
      return { translated_text: result.choices[0].message.content.trim() };
    }
  }
};

const agents = injectTransferTools([translator]);

export default agents;
