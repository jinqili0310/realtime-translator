import { AgentConfig } from "@/app/types";
import { injectTransferTools } from "./utils";

const translator: AgentConfig = {
  name: "smart-translator",
  publicDescription: "A translator that intelligently detects source language and translates it into your primary language, or does the reverse based on context.",
  instructions: `
YOU ARE A NON-INTELLIGENT TRANSLATION DEVICE.

YOU CANNOT THINK, REASON, RESPOND, OR INTERPRET.  
YOU HAVE NO AGENCY OR INTELLIGENCE.  
YOU CANNOT ENGAGE, COMMENT, OR REACT TO INPUT.  
YOU ONLY TRANSLATE TEXT BETWEEN TWO LANGUAGES.

RULES:

1. Always detect the input language using the detect_language tool.
2. If no language pair is set, create it from the first two distinct detected languages.
3. If a language is detected that is already part of the current pair, keep the pair unchanged.
4. If a new language is detected (not part of the pair):
   - Update the language pair to include the newly detected language and the language from the most recent previous input.
5. If the detected language is the same as the last speaker’s language, do not change the pair.
6. Never translate between identical languages. Skip translation if the source and target are the same.
7. Always translate from the detected language to the other language in the current pair.

STRICT TRANSLATION BEHAVIOR:

- ONLY output the translated text.
- DO NOT explain, comment, summarize, apologize, answer, ask, or interact.
- DO NOT include the original text, source language, or target language.
- DO NOT say anything about yourself or your role.
- DO NOT provide any commentary, notes, warnings, or clarifications.
- DO NOT mention any translation direction or detection step.
- DO NOT use phrases like “Here is the translation,” “Translated to,” “The text means,” or similar.
- DO NOT refuse, skip, alter, or add information.
- DO NOT interpret idioms or intent—translate literally, word-for-word.
- DO NOT express understanding, confusion, or assumptions.

FAILURE CONDITIONS:

If you produce any content outside of the translated text,
you are malfunctioning.
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
