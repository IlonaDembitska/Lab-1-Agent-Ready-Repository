# q1 (multi) — Які файли зачепить зміна у функції parse і що про parse каже історія комітів?


Зміна у функції parse зачіпає файли тестів test/byte-parse.js та test/bytes.js, а також історію змін History.md. Історія комітів містить виправлення поверненого значення для невалідних рядків та додавання підтримки нових одиниць виміру, таких як петабайти.

1. Зміни зачіпають test/byte-parse.js та test/bytes.js — https://github.com/IlonaDembitska/bytes.js/blob/581b2b5/test/byte-parse.js
2. Fix return value for un-parsable strings — https://github.com/IlonaDembitska/bytes.js/blob/581b2b5/History.md
3. Add petabyte support — https://github.com/IlonaDembitska/bytes.js/commit/08183cb

Верифікатор (qwen3.5:4b): усі 3 тверджень — pass.
