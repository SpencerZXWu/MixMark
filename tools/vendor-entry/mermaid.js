/**
 * MixMark vendor 入口：Mermaid
 * ---------------------------------------------------------------
 * UML 类图 / 时序图，以及流程图、状态图、ER 图、甘特图、饼图等。
 *
 * **刻意不写进 `index.html`**：产物 2MB 出头（内含 dagre、cytoscape 等
 * 布局引擎），而绝大多数文档里一个图表都没有。改成「第一次遇到
 * ```mermaid 代码块时才插入 <script>」—— 和 katex-inline.js 同一个套路。
 *
 * 之所以能这么做，还是因为它是**经典脚本**：`file://` 下动态插
 * `<script src>` 不受 CORS 限制（被拒的是 `type="module"`），
 * 本地读一个 2MB 文件是毫秒级的。
 *
 * 初始化（主题、安全级别）不在这里做，交给 preview/pipeline.js ——
 * 那里才知道当前是哪个主题。
 */
import mermaid from 'mermaid';

window.mermaid = mermaid;
