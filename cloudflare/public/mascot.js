// Exact original Pi Durable Assistant mascot artwork, adapted for Edge state badges.
const ROBOT_SVG_CONTENT = `
      <g>
        <!-- 烟雾（断线冒烟） -->
        <g class="d-smoke">
          <circle cx="44" cy="10" r="4.5" fill="#94a3b8" />
          <circle cx="56" cy="7" r="5.5" fill="#cbd5e1" />
          <circle cx="50" cy="3" r="3.5" fill="#64748b" />
        </g>

        <!-- Zzz（等待打瞌睡） -->
        <g class="d-zzz">
          <text x="68" y="24" font-size="11" font-weight="bold" fill="var(--primary)" font-family="sans-serif">Z</text>
          <text x="78" y="16" font-size="9" font-weight="bold" fill="var(--primary)" font-family="sans-serif">z</text>
        </g>

        <!-- 思考波纹（思考中） -->
        <circle cx="50" cy="13" r="10" stroke="var(--purple)" stroke-width="1.5" stroke-dasharray="4 2" fill="none" class="d-wave-pulse" />

        <!-- 天线 -->
        <line x1="50" y1="15" x2="50" y2="25" stroke="#6366f1" stroke-width="3" stroke-linecap="round" />
        <circle cx="50" cy="13" r="4.5" fill="#f59e0b" class="d-antenna-tip" />

        <!-- 左右耳 -->
        <rect x="19" y="38" width="6" height="14" rx="3" fill="#6366f1" />
        <rect x="75" y="38" width="6" height="14" rx="3" fill="#6366f1" />

        <!-- 脑袋外框 -->
        <rect x="23" y="25" width="54" height="42" rx="14" fill="#4f46e5" />
        <!-- 面部深色视窗屏 -->
        <rect x="29" y="31" width="42" height="30" rx="8" fill="#1e1b4b" />

        <!-- 1. 空闲表情（眨眼微笑） -->
        <g class="d-expr-idle">
          <rect x="36" y="39" width="6" height="11" rx="3" fill="#38bdf8" class="d-eye-blink" />
          <rect x="58" y="39" width="6" height="11" rx="3" fill="#38bdf8" class="d-eye-blink" />
          <path d="M46 52 Q50 55 54 52" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" fill="none" />
        </g>

        <!-- 2. 断线表情（× 眼睛，波浪哭嘴） -->
        <g class="d-expr-disconnected">
          <path d="M36 40 L42 48 M42 40 L36 48" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" />
          <path d="M58 40 L64 48 M64 40 L58 48" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" />
          <path d="M46 54 Q50 51 54 54" stroke="#ef4444" stroke-width="2" stroke-linecap="round" fill="none" />
        </g>

        <!-- 3. 刚恢复表情（星星眼，开怀大笑） -->
        <g class="d-expr-recovered">
          <polygon points="39,38 40.5,42.5 45,43 41.5,46 42.5,50.5 39,48 35.5,50.5 36.5,46 33,43 37.5,42.5" fill="#facc15" />
          <polygon points="61,38 62.5,42.5 67,43 63.5,46 64.5,50.5 61,48 57.5,50.5 58.5,46 55,43 59.5,42.5" fill="#facc15" />
          <path d="M45 51 Q50 57 55 51 Z" fill="#facc15" />
        </g>

        <!-- 4. 等待打瞌睡表情（弯弯睡眼，小嘴） -->
        <g class="d-expr-waiting">
          <path d="M35 45 Q39 40 43 45" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <path d="M57 45 Q61 40 65 45" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <ellipse cx="50" cy="52" rx="2.5" ry="1.8" fill="#94a3b8" />
        </g>

        <!-- 5. 用工具表情（坚定眼神） -->
        <g class="d-expr-tool">
          <circle cx="39" cy="44" r="4.5" fill="#38bdf8" />
          <circle cx="61" cy="44" r="4.5" fill="#38bdf8" />
          <path d="M46 52 L54 52" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />
        </g>

        <!-- 6. 思考中表情（旋转圈圈眼） -->
        <g class="d-expr-thinking">
          <circle cx="39" cy="44" r="5" stroke="#a855f7" stroke-width="2.5" stroke-dasharray="8 4" fill="none" class="d-eye-spin" />
          <circle cx="61" cy="44" r="5" stroke="#a855f7" stroke-width="2.5" stroke-dasharray="8 4" fill="none" class="d-eye-spin" />
          <path d="M47 52 Q50 50 53 52" stroke="#a855f7" stroke-width="2" stroke-linecap="round" fill="none" />
        </g>

        <!-- 7. 有提醒表情（开心圆眼，抱闹钟） -->
        <g class="d-expr-reminder">
          <path d="M35 45 Q39 39 43 45" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <path d="M57 45 Q61 39 65 45" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <path d="M46 52 Q50 55 54 52" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" fill="none" />
        </g>

        <!-- 8. 出错表情（难过眼睛，委屈瘪嘴，眼角带泪光） -->
        <g class="d-expr-error">
          <path d="M35 39 L42 42" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />
          <path d="M65 39 L58 42" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />
          <ellipse cx="39" cy="45" rx="3.5" ry="4" fill="#38bdf8" />
          <ellipse cx="61" cy="45" rx="3.5" ry="4" fill="#38bdf8" />
          <circle cx="40" cy="44" r="1.2" fill="#ffffff" />
          <circle cx="62" cy="44" r="1.2" fill="#ffffff" />
          <path d="M46 53 Q50 49 54 53" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" fill="none" />
          <circle cx="35" cy="50" r="1.5" fill="#38bdf8" />
        </g>

        <!-- 身体躯干 -->
        <rect x="33" y="68" width="34" height="24" rx="8" fill="#6366f1" />
        <rect x="42" y="74" width="16" height="12" rx="4" fill="#4338ca" />
        <circle cx="50" cy="80" r="3" fill="#38bdf8" />

        <!-- 左臂 -->
        <path d="M32 72 Q24 78 24 86" stroke="#6366f1" stroke-width="5" stroke-linecap="round" fill="none" />

        <!-- 右臂（正常） -->
        <path d="M68 72 Q76 78 76 86" stroke="#6366f1" stroke-width="5" stroke-linecap="round" fill="none" class="d-normal-arm" />

        <!-- 工具道具（举扳手） -->
        <g class="d-prop-tool">
          <g class="d-arm-wrench">
            <path d="M68 72 Q78 66 82 54" stroke="#6366f1" stroke-width="5.5" stroke-linecap="round" fill="none" />
            <path d="M82 54 L90 46 M87 43 A4 4 0 1 1 93 49" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" fill="none" />
          </g>
        </g>

        <!-- 闹钟道具（抱着小闹钟） -->
        <g class="d-prop-clock">
          <g class="d-clock-accessory">
            <circle cx="12" cy="12" r="10" fill="#fef3c7" stroke="#d97706" stroke-width="2" />
            <path d="M6 3 L9 6 M18 3 L15 6" stroke="#d97706" stroke-width="2" stroke-linecap="round" />
            <path d="M12 7 L12 12 L15 12" stroke="#92400e" stroke-width="1.5" stroke-linecap="round" />
          </g>
        </g>

        <!-- 底座轮轴 -->
        <rect x="37" y="93" width="26" height="6" rx="3" fill="#312e81" />
      </g>
    `;
function edgeSetMascotState(state, text) {
  const card = document.getElementById('mascot-card');
  if (card) card.dataset.state = state;
  const status = document.getElementById('mascot-status-tag');
  if (status) status.textContent = text || (state === 'thinking' ? '工作中' : '空闲中');
  const bubble = document.getElementById('mascot-text');
  if (bubble) bubble.textContent = state === 'thinking' ? '正在执行任务…' : '随时可以开始';
}
const mascot = document.getElementById('mascot-svg');
if (mascot) mascot.innerHTML = ROBOT_SVG_CONTENT;
window.edgeSetMascotState = edgeSetMascotState;
edgeSetMascotState('idle', '空闲中');
