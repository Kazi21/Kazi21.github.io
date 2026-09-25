// prerender-math.js — renders the equations of index.template.html to static HTML.
// Usage (from the repository root):  node tools/prerender-math.js
// Requires: npm install katex@0.16.11   (KaTeX CSS and fonts are vendored in vendor/katex/)
// The website itself never loads katex.min.js: equations are static markup.

const fs = require("fs");
const path = require("path");
const katex = require("katex");

const root = path.resolve(__dirname, "..");
const templatePath = path.join(__dirname, "index.template.html");
const outPath = path.join(root, "index.html");

const equations = {
  EQ_VOI: String.raw`a^{*}=\arg\max_{a}\;\frac{\operatorname{Var}\!\left(J\mid\mathcal D\right)-\mathbb E\!\left[\operatorname{Var}\!\left(J\mid\mathcal D\cup\mathcal D_{a}\right)\right]}{C_{a}}`,
  EQ_COST: String.raw`C_{a}=w_{\mathrm{CPU}}\,C_{\mathrm{CPU}}+w_{\mathrm{GPU}}\,C_{\mathrm{GPU}}+w_{\mathrm{DFT}}\,C_{\mathrm{DFT}}+w_{\mathrm{human}}\,C_{\mathrm{human}}`,
  EQ_RESIDUAL: String.raw`E_{\mathrm{model}}=E_{\mathrm{baseline}}+\Delta E_{\theta},\qquad \mathbf F=-\nabla E_{\mathrm{model}}`,
  EQ_SCORE: String.raw`S_{\mathrm{frame}}=S_{\mathrm{uncertainty}}\;S_{\mathrm{diversity}}\;S_{\mathrm{event}}\;S_{\mathrm{observable}}`,
  EQ_VAR: String.raw`\operatorname{Var}(J)\approx\nabla_{\boldsymbol\theta}J^{\mathsf T}\,\mathbf C_{\boldsymbol\theta}\,\nabla_{\boldsymbol\theta}J`,
  EQ_DFT: String.raw`D_{\mathrm{O}}^{\mathrm{FT}}(N,\tau)=\frac{\left\langle\left|\tilde{\mathbf r}_{\mathrm{O}}(t+\tau)-\tilde{\mathbf r}_{\mathrm{O}}(t)\right|^{2}\right\rangle}{6\,\tau}`,
  EQ_CI: String.raw`\bar D\;\pm\;t_{R-1,\,1-\alpha/(2K)}\;\frac{s_{D}}{\sqrt{R}}`,
};

let html = fs.readFileSync(templatePath, "utf8");
for (const [key, tex] of Object.entries(equations)) {
  const rendered = katex.renderToString(tex, { displayMode: true, throwOnError: true, output: "htmlAndMathml" });
  const token = `{{${key}}}`;
  if (!html.includes(token)) { console.log(`note: ${token} not used in this template`); continue; }
  html = html.split(token).join(rendered);
}
const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
if (leftover) throw new Error(`unrendered tokens: ${leftover.join(", ")}`);

fs.writeFileSync(outPath, html);
console.log(`wrote ${path.relative(root, outPath)} (${(html.length / 1024).toFixed(1)} kB)`);
