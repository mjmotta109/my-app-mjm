# Por qué Rinde no usa la tabla del ICBF (todavía)

Este archivo lo escribe una persona; `EXPLORACION.md` lo regenera el CI.

La exploración de `icbf.gov.co` encontró la **Tabla de Composición de
Alimentos Colombianos (TCAC 2015)** y un estudio de 18 preparaciones
tradicionales, los tres en PDF. Los tres traen el permiso **`copy:no`**: el
propio documento prohíbe copiar su contenido (ver metadatos en
`EXPLORACION.md`).

`pdftotext` ignora ese permiso, y una primera corrida extrajo el texto. **Se
borró del árbol sin haberse tomado un solo valor**, y el workflow ya no extrae
nada de un PDF que lo prohíba. Ese texto sigue en el historial de git (commit
`0beedf9`) hasta que se decida purgarlo.

La TCAC es la fuente correcta para los ingredientes que USDA no trae: papa
criolla, panela, arracacha, bocadillo, kumis, queso costeño. Incorporarla a una
aplicación requiere un permiso del ICBF o una versión publicada como datos
abiertos. Hasta entonces esos ingredientes siguen marcados como estimados, y la
interfaz lo dice.
