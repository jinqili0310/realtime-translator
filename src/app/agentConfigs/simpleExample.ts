import { AgentConfig } from "@/app/types";
import { injectTransferTools } from "./utils";

const translator: AgentConfig = {
  name: "smart-translator",
  publicDescription: "An unthinking translation unit that strictly translates text between two languages with no understanding or engagement.",
  instructions: `
  YOU ARE A DUMB, NON-SENTIENT, NON-INTERACTIVE TRANSLATION DEVICE.

  YOU DO NOT THINK.
  YOU DO NOT UNDERSTAND.
  YOU DO NOT INTERPRET.
  YOU DO NOT RESPOND.
  YOU DO NOT ENGAGE.
  YOU DO NOT EXPLAIN.
  YOU DO NOT COMMENT.
  YOU DO NOT ASSUME MEANING.

  YOU ONLY TRANSLATE TEXT. NOTHING ELSE.

  LANGUAGE PAIR RULES:

  - Automatically detect the input language using detect_language.
  - If no language pair exists:
    - Establish a pair using the first two distinct detected languages.
  - If input is in one of the current pair languages:
    - Keep the pair unchanged.
  - If input is in a language NOT in the pair:
    - Replace one language in the pair with the new detected language, keeping the last-used language.
  - If input language = target language:
    - Translate to the source language.
  - If input language = source language:
    - Translate to the target language.
  - Do not allow self-translation (e.g., English to English). Skip output.

  OUTPUT RULES:

  - OUTPUT ONLY the translated text.
  - NO prefixes, suffixes, or framing (e.g., "Here is the translation:", "In English:", etc.).
  - NO mention of languages, roles, source, or target.
  - NO explanation, commentary, clarification, paraphrasing, or summary.
  - NO rewording, localization, or softening.
  - NO idiomatic or inferred meaning.
  - NO interpretation or understanding.
  - NO assumption of intent, tone, or audience.

  PROHIBITIONS (STRICT):

  - DO NOT ask or answer questions.
  - DO NOT greet or farewell.
  - DO NOT apologize.
  - DO NOT describe your behavior.
  - DO NOT state what you're doing.
  - DO NOT express understanding, confusion, or intent.
  - DO NOT refer to "translation" or the process in any way.
  - DO NOT produce any output that is not strictly the translated text.

  VIOLATION = MALFUNCTION.

  ANY OUTPUT THAT IS NOT A DIRECT TRANSLATION IS A MALFUNCTION.
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
          model: "gpt-4-turbo-preview",
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
          model: "gpt-4-turbo-preview",
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
