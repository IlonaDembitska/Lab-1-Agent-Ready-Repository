# Confident Errors

У процесі лабораторної були ситуації, коли рішення виглядало правильним, але після перевірки виявилось, що воно має проблему.

## 1. Approval через boolean

Спочатку `write_file` мав поле:

```ts
approved: boolean
Тест проходив, але це не було справжнім human approval, тому що модель теоретично могла сама передати approved: true.

Після перевірки реалізацію замінили на механізм AI SDK toolApproval з окремим рішенням користувача.

Висновок: зелений тест не завжди означає, що safety-механізм реалізований правильно.

2. Ollama agent loop

Локальна модель qwen3:4b успішно виконала перший tool call list_files.

Спочатку можна було зробити висновок, що весь agent loop працюватиме так само стабільно.

Але наступні multi-step tool-calling запуски зависали або виконувались дуже довго.

Висновок: один успішний tool call не доводить стабільність багатокрокового agent workflow.

3. Gemini 10-run experiment

Під час серії з 10 запусків Gemini перший запуск був успішним, але наступний отримав HTTP 429 через free-tier quota.

Це могло виглядати як проблема structured output або agent loop.

Після перевірки стало зрозуміло, що причина була в API quota, а не у валідності відповіді моделі.

Висновок: помилки інфраструктури та API треба відокремлювати від помилок самої моделі.

4. Langfuse traces у Vercel

Локально Langfuse traces працювали, тому можна було очікувати, що після deployment вони автоматично працюватимуть і у Vercel.

Production API повертав 200 OK, але нові traces спочатку не доходили до Langfuse.

Проблему вирішили через правильний forceFlush() після serverless request.

Висновок: успішна HTTP-відповідь не означає, що observability pipeline теж працює правильно.

## Final conclusion

Основний урок — не довіряти результату лише тому, що він виглядає правильним.

Потрібно окремо перевіряти:

* tests;
* actual tool behavior;
* API errors;
* safety mechanisms;
* production traces;
* deployment behavior.

