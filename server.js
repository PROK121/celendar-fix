import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) return;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

loadDotEnv();

const app = express();

// Google Identity Services общается с popup/iframe через postMessage. Слишком строгий COOP
// у страницы ломает это; same-origin-allow-popups — типичная настройка для OAuth во всплывающем окне.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const PORT = Number(process.env.PORT || 8080);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_MODEL_FALLBACKS = (process.env.GEMINI_MODELS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

app.use(express.static(process.cwd()));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function tryParseJsonFromText(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const jsonCandidate = fenced ? fenced[1] : raw;
  const start = jsonCandidate.indexOf('{');
  const end = jsonCandidate.lastIndexOf('}');
  const payload = start >= 0 && end > start ? jsonCandidate.slice(start, end + 1) : jsonCandidate;
  return JSON.parse(payload);
}

function validateTransactions(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    if (!t || typeof t !== 'object') continue;
    const date = String(t.date || '').trim();
    const amount = Number(t.amount);
    const type = String(t.type || '').trim().toLowerCase();
    const category = String(t.category || '').trim();
    const description = String(t.description || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (type !== 'income' && type !== 'expense') continue;
    if (!category) continue;
    out.push({
      date,
      amount,
      type,
      category,
      description: description || 'Импорт из выписки'
    });
  }
  return out;
}

async function listGeminiModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return [];
  const models = Array.isArray(data.models) ? data.models : [];
  return models
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
}

app.post('/api/parse-bank-pdf', upload.single('statement'), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'GEMINI_API_KEY не задан на сервере' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'PDF файл не передан' });
    }

    const pdfBase64 = req.file.buffer.toString('base64');

    const prompt = [
      'Ты анализируешь банковскую выписку (PDF) и возвращаешь JSON.',
      'Нужно извлечь операции и вернуть СТРОГО JSON без пояснений.',
      'Формат ответа:',
      '{',
      '  "transactions": [',
      '    {',
      '      "date": "YYYY-MM-DD",',
      '      "amount": 12345.67,',
      '      "type": "income|expense",',
      '      "category": "Зарплата|Питание|Жилье|Транспорт|Коммунальные услуги|Долги и кредиты|Здоровье|Образование|Развлечения|Прочее",',
      '      "description": "краткое описание операции"',
      '    }',
      '  ]',
      '}',
      'Правила:',
      '- amount всегда положительное число.',
      '- date всегда дата проведения операции.',
      '- Не включай служебные заголовки, итоги, входящий/исходящий остаток.',
      '- Не дублируй одинаковые операции.'
    ].join('\n');

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: req.file.mimetype || 'application/pdf',
                data: pdfBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    };

    const modelCandidates = [
      GEMINI_MODEL,
      ...GEMINI_MODEL_FALLBACKS,
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash-latest'
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);

    const available = await listGeminiModels(apiKey);
    const ordered = [
      ...modelCandidates.filter((m) => available.includes(m)),
      ...available
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);
    const finalCandidates = ordered.length ? ordered : modelCandidates;

    let data = null;
    let lastError = null;
    for (let i = 0; i < finalCandidates.length; i++) {
      const model = finalCandidates[i];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      data = await r.json().catch(() => ({}));
      if (r.ok) {
        lastError = null;
        break;
      }
      lastError = data?.error?.message || `Gemini API error: HTTP ${r.status}`;
      data = null;
    }

    if (!data) {
      return res.status(502).json({
        success: false,
        message: lastError || 'Не удалось вызвать Gemini с доступными моделями'
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
    let parsed;
    try {
      parsed = tryParseJsonFromText(text);
    } catch (_e) {
      return res.status(502).json({ success: false, message: 'Gemini вернул невалидный JSON' });
    }

    const transactions = validateTransactions(parsed?.transactions);
    if (!transactions.length) {
      return res.status(200).json({ success: false, message: 'Операции не распознаны', transactions: [] });
    }
    return res.json({ success: true, transactions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

app.listen(PORT, () => {
  const hasEnv = fs.existsSync(path.join(process.cwd(), '.env'));
  console.log(`[server] started on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log('[server] GEMINI_API_KEY is not set');
  }
  if (!hasEnv) {
    console.log('[server] Tip: create .env with GEMINI_API_KEY=...');
  }
  console.log(`[server] GEMINI_MODEL=${GEMINI_MODEL}`);
});

