/* =========================================================
   common.js — utilidades usadas pelas duas páginas
   ========================================================= */
const Aethos = (() => {
  // ---------- Paleta (identidade Aethos: marinho #1A2836 + verde #85C441) ----------
  const CORES = {
    primaria: '#1A2836',        // azul-marinho Aethos
    primariaEscura: '#1A2836',
    verde: '#85C441',           // verde Aethos
    verdeEscuro: '#4E8A1E',     // verde para texto sobre fundo branco
    fb: '#2F6FB0',              // Facebook Ads
    org: '#85C441',             // Orgânico
    orgTexto: '#4E8A1E',
    orgCalor: '#5E9A2C',        // verde do mapa de calor (texto branco legível)
    vermelho: '#E5484D',
    ambar: '#F2A93B',
    texto: '#1A2836',
    texto2: '#4A5A6A',
    muted: '#8A97A6',
    grade: '#EEF2F6',
    estrelas: ['#E5484D', '#F2994A', '#F2C94C', '#B5D86F', '#85C441'], // 1★ vermelho -> 5★ verde Aethos
    vendedores: ['#1A2836', '#85C441', '#2F6FB0', '#F2A93B', '#7A6FB8', '#3FA7A3'],
    perdas: ['#1A2836', '#85C441', '#2F6FB0', '#E5484D', '#F2A93B', '#3FA7A3', '#7A6FB8',
             '#B5D86F', '#5B7A99', '#F2C94C', '#C2363B', '#4E8A1E', '#9AA9B8'],
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

  // Cor do texto que fica legível sobre um fundo (marinho em fundos claros, branco em escuros)
  const textoSobre = (hex) => {
    if (typeof hex !== 'string' || !hex.startsWith('#')) return '#ffffff';
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminancia > 0.35 ? CORES.texto : '#ffffff';
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
    t.backgroundColor = CORES.primaria;
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
    CORES, PLUGINS, num, soma, pct, paraNumeros, escapeHtml, hexToRgba, textoSobre,
    lerDados, configurarChartJs, rotulo, pluginTextoCentral,
    renderKpis, renderLegenda, preencherRodape, aoCarregar,
  };
})();
