import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { text, source_language, target_language, model, temperature, max_tokens } = await request.json();

    if (!text || !source_language || !target_language) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: model || 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a strict translation system. Your only task is to translate text from ${source_language} to ${target_language}. Do not interpret, understand, or make assumptions about the text. Do not add any explanations or additional text. Only output the direct translation. If you cannot translate a word or phrase, keep it in the original language.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: temperature || 0.3,
      max_tokens: max_tokens || 150,
      stream: false
    });

    const translated_text = completion.choices[0].message.content?.trim();

    return NextResponse.json({ translated_text });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: 'Translation failed' },
      { status: 500 }
    );
  }
} 