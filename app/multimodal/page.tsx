'use client';

/**
 * Сторінка мультимодального асистента (Лаб. 4, крок 05).
 * Розмір і тип перевіряються ТУТ, у браузері, до надсилання: інакше файл понад 4,5 MB отримав би
 * 413 від платформи, і жодного зрозумілого слова користувач би не побачив.
 */
import { useState, type FormEvent } from 'react';

import { ALLOWED, formatBytes, MAX_BYTES, precheck } from '../../src/multimodal/limits';

const box = { border: '1px solid var(--border)', borderRadius: '0.75rem', background: 'var(--panel)', padding: '1rem' } as const;

export default function MultimodalPage() {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState('');
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const [audio, setAudio] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage('');
    setAnswer('');
    setAudio('');
    if (file === null) {
      setMessage('Оберіть файл.');
      return;
    }
    // ДРУЖНЯ ВІДМОВА: та сама функція й константа, що на сервері.
    const rejected = precheck(file.type, file.size);
    if (rejected !== null) {
      setMessage(`Файл не надіслано: ${rejected.detail}.`);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('mode', 'ask');
      fd.set('file', file);
      fd.set('mediaType', file.type);
      fd.set('question', question);
      const res = await fetch('/api/multimodal', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({ ok: false, detail: `HTTP ${res.status}` }))) as { ok: boolean; text?: string; detail?: string };
      if (data.ok && data.text !== undefined) setAnswer(data.text);
      else setMessage(`Не вдалося: ${data.detail ?? `HTTP ${res.status}`}`);
    } finally {
      setBusy(false);
    }
  }

  async function onSpeak() {
    const fd = new FormData();
    fd.set('mode', 'speak');
    fd.set('text', answer);
    setBusy(true);
    try {
      const res = await fetch('/api/multimodal', { method: 'POST', body: fd });
      const data = (await res.json()) as { ok: boolean; audioBase64?: string; mediaType?: string; detail?: string };
      if (data.ok && data.audioBase64 !== undefined) setAudio(`data:${data.mediaType ?? 'audio/wav'};base64,${data.audioBase64}`);
      else setMessage(`Озвучення не вдалося: ${data.detail ?? `HTTP ${res.status}`}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem', display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0 }}>Питання до документа</h1>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Фото чи скан сторінки або PDF → відповідь із номером сторінки; відповідь можна прослухати. Типи: {ALLOWED.join(', ')}; до {formatBytes(MAX_BYTES)}.
      </p>
      <form onSubmit={onSubmit} style={{ ...box, display: 'grid', gap: '0.75rem' }}>
        <input type="file" accept={ALLOWED.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <input type="text" placeholder="Питання до файлу" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? 'Зачекайте…' : 'Запитати'}</button>
      </form>
      {message !== '' && <p role="alert" style={{ ...box, color: 'crimson', margin: 0 }}>{message}</p>}
      {answer !== '' && (
        <section style={{ ...box, display: 'grid', gap: '0.5rem' }}>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{answer}</p>
          <button type="button" onClick={onSpeak} disabled={busy}>Озвучити відповідь</button>
          {audio !== '' && <audio controls src={audio} />}
        </section>
      )}
    </main>
  );
}
