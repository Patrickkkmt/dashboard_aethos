/* =========================================================
   common.js — utilidades usadas pelas duas páginas
   ========================================================= */
const Aethos = (() => {
  // ---------- Paleta ----------
  const CORES = {
    primaria: '#6366f1',
    primariaEscura: '#4338ca',
    fb: '#1877F2',
    org: '#34d399',
    orgTexto: '#059669',      // verde mais escuro, legível sobre fundo branco
    texto: '#1e293b',
    texto2: '#475569',
    muted: '#94a3b8',
    grade: '#f1f5f9',
    estrelas: ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'], // 1★ vermelho -> 5★ verde
    vendedores: ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#0ea5e9'],
    perdas: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981',
             '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6'],
  };

  // ---------- Números ----------
  const formatador = new Intl.NumberFormat('pt-BR');
  const num = (v) => formatador.format(Number(v) || 0);
  const soma = (arr) => (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const pct = (valor, total, casas = 1) =>
    total ? `${((valor / total) * 100).toFixed(casas).replace('.', ',')}%` : '0%';
  const paraNumeros = (arr) => (arr || []).map((v) => Number(v) || 0);

  // ---------- Texto ----------
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const hexToRgba = (hex, alpha) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };

  // ---------- Dados injetados pelo Flask ----------
  function lerDados(idScript) {
    const el = document.getElementById(idScript);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (erro) {
      console.error('Não foi possível ler os dados do painel:', erro);
      return null;
    }
  }

  // ---------- Chart.js ----------
  // Plugin de rótulos (números em cima das barras). Se o CDN falhar, os gráficos funcionam sem ele.
  const PLUGINS = window.ChartDataLabels ? [window.ChartDataLabels] : [];

  function configurarChartJs() {
    const d = Chart.defaults;
    d.font.family = "'DM Sans', system-ui, sans-serif";
    d.font.size = 12;
    d.color = CORES.muted;
    d.maintainAspectRatio = false;
    d.responsive = true;

    // Passar o mouse mostra todos os valores daquela coluna/mês de uma vez
    d.interaction.mode = 'index';
    d.interaction.intersect = false;

    d.plugins.legend.labels.usePointStyle = true;
    d.plugins.legend.labels.boxWidth = 8;
    d.plugins.legend.labels.boxHeight = 8;
    d.plugins.legend.labels.padding = 16;
    d.plugins.legend.labels.color = CORES.texto2;

    const t = d.plugins.tooltip;
    t.backgroundColor = '#1e293b';
    t.titleColor = '#f8fafc';
    t.bodyColor = '#cbd5e1';
    t.footerColor = '#f8fafc';
    t.padding = 12;
    t.cornerRadius = 8;
    t.boxPadding = 4;
    t.usePointStyle = true;
    t.titleFont = { weight: '600' };
  }

  // Estilo padrão dos números que aparecem nos gráficos
  const rotulo = (extra = {}) => ({
    color: CORES.texto,
    font: { family: "'DM Mono', monospace", weight: '500', size: 11 },
    clamp: true,
    ...extra,
  });

  // Escreve o número total no meio do gráfico de rosca
  const pluginTextoCentral = {
    id: 'textoCentral',
    afterDraw(chart, _args, opcoes) {
      if (!opcoes || opcoes.valor == null) return;
      const { ctx, chartArea } = chart;
      const x = (chartArea.left + chartArea.right) / 2;
      const y = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CORES.texto;
      ctx.font = "500 24px 'DM Mono', monospace";
      ctx.fillText(opcoes.valor, x, y - 8);
      ctx.fillStyle = CORES.muted;
      ctx.font = "500 11px 'DM Sans', sans-serif";
      ctx.fillText(opcoes.rotulo || '', x, y + 14);
      ctx.restore();
    },
  };

  // ---------- Componentes de página ----------
  function renderKpis(container, kpis) {
    container.innerHTML = kpis.map((k) => `
      <div class="kpi kpi--${k.cor}">
        <p class="kpi__label">${escapeHtml(k.rotulo)}</p>
        <p class="kpi__value">${escapeHtml(k.valor)}</p>
        ${k.sub ? `<p class="kpi__sub">${escapeHtml(k.sub)}</p>` : ''}
        <div class="kpi__bar"></div>
      </div>`).join('');
  }

  function renderLegenda(container, itens) {
    if (!container) return;
    container.innerHTML = itens.map((i) => `
      <span class="legend__item">
        <span class="legend__swatch" style="background:${i.cor}"></span>
        ${escapeHtml(i.rotulo)} <span class="legend__value">${escapeHtml(i.valor)}</span>
      </span>`).join('');
  }

  function preencherRodape() {
    const el = document.getElementById('ano-atual');
    if (el) el.textContent = new Date().getFullYear();
  }

  // Espera as fontes carregarem para os gráficos já nascerem com a fonte certa
  function aoCarregar(fn) {
    const pronto = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([pronto, new Promise((r) => setTimeout(r, 1500))]).then(fn);
  }

  return {
    CORES, PLUGINS, num, soma, pct, paraNumeros, escapeHtml, hexToRgba,
    lerDados, configurarChartJs, rotulo, pluginTextoCentral,
    renderKpis, renderLegenda, preencherRodape, aoCarregar,
  };
})();
