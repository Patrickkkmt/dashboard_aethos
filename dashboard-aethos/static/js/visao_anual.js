/* =========================================================
   visao_anual.js — página de desempenho anual
   ========================================================= */
(() => {
  const { CORES, PLUGINS, num, soma, pct, paraNumeros, rotulo, escapeHtml, hexToRgba } = Aethos;

  Aethos.preencherRodape();

  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const bruto = Aethos.lerDados('dados-anual');
  if (!bruto) return;

  // ---------------------------------------------------------
  // 1. PREPARA OS DADOS — corta os meses futuros (sem leads)
  // ---------------------------------------------------------
  const fbBruto = paraNumeros(bruto.total_leads?.facebook);
  const orgBruto = paraNumeros(bruto.total_leads?.organico);
  const totalBruto = bruto.total_leads?.total?.length
    ? paraNumeros(bruto.total_leads.total)
    : fbBruto.map((v, i) => v + (orgBruto[i] || 0));

  let ultimoMes = totalBruto.length - 1;
  while (ultimoMes >= 0 && totalBruto[ultimoMes] === 0) ultimoMes--;
  const qtdMeses = Math.max(ultimoMes + 1, 1); // mostra pelo menos Janeiro

  // Corta no último mês com dados e completa com zero se faltar algum valor
  const cortar = (arr) => {
    const a = paraNumeros(arr).slice(0, qtdMeses);
    while (a.length < qtdMeses) a.push(0);
    return a;
  };

  const meses = (bruto.labels_meses || MESES).slice(0, qtdMeses);
  const leads = { fb: cortar(fbBruto), org: cortar(orgBruto), total: cortar(totalBruto) };
  const perdasFb = (bruto.perdas_fb || []).map((m) => ({ label: m.label, data: cortar(m.data) }));
  const perdasOrg = (bruto.perdas_org || []).map((m) => ({ label: m.label, data: cortar(m.data) }));
  const vendedores = Object.entries(bruto.vendedores || {}).map(([nome, data]) => ({ nome, data: cortar(data) }));

  // ---------------------------------------------------------
  // 2. CABEÇALHO E KPIs
  // ---------------------------------------------------------

  const totalAno = soma(leads.total);
  const fbAno = soma(leads.fb);
  const orgAno = soma(leads.org);
  const melhorIdx = leads.total.indexOf(Math.max(...leads.total));

  Aethos.renderKpis(document.getElementById('kpi-strip'), [
    { rotulo: 'Leads no ano', valor: num(totalAno), sub: `${meses[0]}${meses.length > 1 ? ` a ${meses[meses.length - 1]}` : ''} · ${qtdMeses} ${qtdMeses === 1 ? 'mês' : 'meses'}`, cor: 'marinho' },
    { rotulo: 'Facebook Ads', valor: num(fbAno), sub: `${pct(fbAno, totalAno)} do total`, cor: 'azul' },
    { rotulo: 'Orgânico', valor: num(orgAno), sub: `${pct(orgAno, totalAno)} do total`, cor: 'verde' },
    {
      rotulo: 'Média mensal',
      valor: num(Math.round(totalAno / qtdMeses)),
      sub: totalAno ? `melhor mês: ${meses[melhorIdx]} (${num(leads.total[melhorIdx])})` : 'sem dados ainda',
      cor: 'marinho',
    },
  ]);

  // ---------------------------------------------------------
  // 3. HELPERS DE GRÁFICO
  // ---------------------------------------------------------
  const eixoX = { grid: { display: false }, border: { display: false }, ticks: { color: '#64748b', font: { weight: '500' } } };
  const eixoY = { grid: { color: CORES.grade }, border: { display: false }, ticks: { precision: 0 } };
  const legendaBaixo = { position: 'bottom', labels: { padding: 14, font: { size: 12 } } };

  // Série com o total do ano na legenda ("Facebook Ads (640)")
  const serie = (nome, data, extra = {}) => ({ nome, label: `${nome} (${num(soma(data))})`, data, ...extra });
  const tooltipNome = (ctx) => ` ${ctx.dataset.nome}: ${num(ctx.parsed.y)}`;

  // Número dentro da barra empilhada — só aparece se a fatia tiver altura suficiente
  const rotuloDentro = (maximo) => rotulo({
    color: (ctx) => Aethos.textoSobre(ctx.dataset.backgroundColor),
    anchor: 'center',
    align: 'center',
    font: { family: "'DM Mono', monospace", weight: '500', size: 10 },
    display: (ctx) => {
      const v = ctx.dataset.data[ctx.dataIndex];
      return v > 0 && v / maximo >= 0.08;
    },
    formatter: (v) => num(v),
  });

  // Linha "Total" usada para escrever o total em cima de cada coluna
  const serieTotal = (totais, visivel) => ({
    type: 'line',
    tipo: 'total',
    nome: 'Total',
    label: `Total (${num(soma(totais))})`,
    data: totais,
    stack: 'total',
    order: 0,
    borderColor: CORES.primaria,
    backgroundColor: CORES.primaria,
    borderWidth: visivel ? 2 : 0,
    borderDash: [5, 5],
    tension: 0.3,
    showLine: visivel,
    pointRadius: visivel ? 4 : 0,
    pointHoverRadius: visivel ? 6 : 0,
    pointBackgroundColor: '#ffffff',
    pointBorderWidth: 2,
    datalabels: rotulo({
      align: 'top',
      offset: visivel ? 6 : 2,
      color: CORES.primariaEscura,
      backgroundColor: visivel ? 'rgba(255,255,255,.9)' : null,
      borderRadius: 4,
      padding: { top: 1, bottom: 1, left: 4, right: 4 },
      font: { family: "'DM Mono', monospace", weight: '500', size: 11 },
      display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
      formatter: (v) => num(v),
    }),
  });

  // ---------------------------------------------------------
  // 4. MAPA DE CALOR — motivos de perda × mês
  // ---------------------------------------------------------
  function renderMapaCalor(idContainer, motivos, corBase) {
    const el = document.getElementById(idContainer);
    const linhas = motivos
      .map((m) => ({ label: m.label, data: m.data, total: soma(m.data) }))
      .filter((l) => l.total > 0)
      .sort((a, b) => b.total - a.total);

    if (!linhas.length) {
      el.innerHTML = '<p class="empty">Nenhuma perda registrada neste período.</p>';
      return;
    }

    const maximo = Math.max(...linhas.flatMap((l) => l.data), 1);
    const totaisMes = meses.map((_, i) => soma(linhas.map((l) => l.data[i])));
    const totalGeral = soma(totaisMes);

    const celula = (v, motivo, mes) => {
      if (!v) return `<td class="is-zero" title="${escapeHtml(motivo)} · ${mes}: 0">0</td>`;
      const intensidade = v / maximo;
      const fundo = hexToRgba(corBase, 0.12 + intensidade * 0.78);
      const texto = intensidade > 0.5 ? '#ffffff' : CORES.texto;
      return `<td style="background:${fundo};color:${texto}" title="${escapeHtml(motivo)} · ${mes}: ${num(v)}">${num(v)}</td>`;
    };

    el.innerHTML = `
      <table class="heatmap">
        <thead>
          <tr>
            <th class="heatmap__motivo">Motivo</th>
            ${meses.map((m) => `<th>${escapeHtml(m)}</th>`).join('')}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${linhas.map((l) => `
            <tr>
              <th class="heatmap__motivo">${escapeHtml(l.label)}</th>
              ${l.data.map((v, i) => celula(v, l.label, meses[i])).join('')}
              <td class="heatmap__total">${num(l.total)}<small>${pct(l.total, totalGeral)}</small></td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <th class="heatmap__motivo">Total do mês</th>
            ${totaisMes.map((t) => `<td>${num(t)}</td>`).join('')}
            <td class="heatmap__total">${num(totalGeral)}</td>
          </tr>
        </tfoot>
      </table>`;
  }

  // Versão em linhas (criada só quando o usuário clica em "Gráfico")
  function graficoLinhasPerdas(idCanvas, motivos) {
    const series = motivos
      .map((m) => ({ ...m, total: soma(m.data) }))
      .filter((m) => m.total > 0)
      .sort((a, b) => b.total - a.total);

    new Chart(document.getElementById(idCanvas), {
      type: 'line',
      data: {
        labels: meses,
        datasets: series.map((m, i) => serie(m.label, m.data, {
          borderColor: CORES.perdas[i % CORES.perdas.length],
          backgroundColor: CORES.perdas[i % CORES.perdas.length],
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 6,
        })),
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 11 } } },
          tooltip: {
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
            filter: (item) => item.parsed.y > 0,
            callbacks: { label: tooltipNome },
          },
        },
        scales: { x: eixoX, y: eixoY },
      },
    });
  }

  // Botões Tabela / Gráfico
  const criadores = {
    'perdas-fb': () => graficoLinhasPerdas('chartPerdasFB', perdasFb),
    'perdas-org': () => graficoLinhasPerdas('chartPerdasOrg', perdasOrg),
  };
  const jaCriados = new Set();

  document.querySelectorAll('.segmented[data-alvo]').forEach((grupo) => {
    const alvo = grupo.dataset.alvo;
    grupo.addEventListener('click', (e) => {
      const botao = e.target.closest('button[data-modo]');
      if (!botao) return;
      grupo.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('is-active', b === botao);
        b.setAttribute('aria-pressed', String(b === botao));
      });
      const modo = botao.dataset.modo;
      document.getElementById(`${alvo}-tabela`).hidden = modo !== 'tabela';
      document.getElementById(`${alvo}-grafico`).hidden = modo !== 'grafico';
      if (modo === 'grafico' && !jaCriados.has(alvo)) {
        jaCriados.add(alvo);
        criadores[alvo]();
      }
    });
  });

  // ---------------------------------------------------------
  // 5. GRÁFICOS
  // ---------------------------------------------------------
  function criarGraficos() {
    Aethos.configurarChartJs();

    // ---- Volume de leads: barras empilhadas FB + Orgânico, linha com o total ----
    const maxTotal = Math.max(...leads.total, 1);
    new Chart(document.getElementById('chartTotalLeads'), {
      type: 'bar',
      plugins: PLUGINS,
      data: {
        labels: meses,
        datasets: [
          serie('Facebook Ads', leads.fb, { backgroundColor: CORES.fb, stack: 'canais', order: 1, borderRadius: 3, maxBarThickness: 48, datalabels: rotuloDentro(maxTotal) }),
          serie('Orgânico', leads.org, { backgroundColor: CORES.org, stack: 'canais', order: 1, borderRadius: 3, maxBarThickness: 48, datalabels: rotuloDentro(maxTotal) }),
          serieTotal(leads.total, true),
        ],
      },
      options: {
        plugins: {
          legend: legendaBaixo,
          tooltip: { callbacks: { label: tooltipNome } },
        },
        scales: {
          x: { ...eixoX, stacked: true },
          y: { ...eixoY, stacked: true, grace: '14%' },
        },
      },
    });

    // ---- Qualidade: barras empilhadas por estrela, total em cima e média no tooltip ----
    const chavesEstrelas = ['1_estrela', '2_estrelas', '3_estrelas', '4_estrelas', '5_estrelas'];

    const graficoQualidade = (idCanvas, qualidade) => {
      const series = chavesEstrelas.map((k) => cortar(qualidade?.[k]));
      const totaisMes = meses.map((_, i) => soma(series.map((s) => s[i])));
      const maximo = Math.max(...totaisMes, 1);

      new Chart(document.getElementById(idCanvas), {
        type: 'bar',
        plugins: PLUGINS,
        data: {
          labels: meses,
          datasets: [
            ...series.map((d, i) => serie(`${i + 1} ★`, d, {
              estrelas: i + 1,
              backgroundColor: CORES.estrelas[i],
              stack: 'qualidade',
              order: 1,
              maxBarThickness: 40,
              datalabels: rotuloDentro(maximo),
            })),
            serieTotal(totaisMes, false),
          ],
        },
        options: {
          plugins: {
            legend: { ...legendaBaixo, labels: { ...legendaBaixo.labels, filter: (item, data) => data.datasets[item.datasetIndex].tipo !== 'total' } },
            tooltip: {
              filter: (item) => item.dataset.tipo !== 'total' && item.parsed.y > 0,
              itemSort: (a, b) => b.dataset.estrelas - a.dataset.estrelas,
              callbacks: {
                label: tooltipNome,
                footer: (itens) => {
                  const n = soma(itens.map((i) => i.parsed.y));
                  if (!n) return '';
                  const media = soma(itens.map((i) => i.parsed.y * i.dataset.estrelas)) / n;
                  return `Total: ${num(n)} · média ${media.toFixed(1).replace('.', ',')} ★`;
                },
              },
            },
          },
          scales: {
            x: { ...eixoX, stacked: true },
            y: { ...eixoY, stacked: true, grace: '12%' },
          },
        },
      });
    };

    graficoQualidade('chartQualidadeFB', bruto.qualidade_fb);
    graficoQualidade('chartQualidadeOrg', bruto.qualidade_org);

    // ---- Vendedores: barras agrupadas por mês, total do ano na legenda ----
    const qtdBarras = Math.max(qtdMeses * vendedores.length, 1);
    new Chart(document.getElementById('chartVendedores'), {
      type: 'bar',
      plugins: PLUGINS,
      data: {
        labels: meses,
        datasets: vendedores.map((v, i) => serie(v.nome, v.data, {
          backgroundColor: CORES.vendedores[i % CORES.vendedores.length],
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 28,
          datalabels: rotulo({
            anchor: 'end',
            align: 'top',
            offset: 1,
            color: CORES.texto2,
            font: { family: "'DM Mono', monospace", weight: '500', size: 10 },
            // Em telas estreitas os números não cabem: o tooltip continua mostrando
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0 && ctx.chart.width / qtdBarras >= 16,
            formatter: (val) => num(val),
          }),
        })),
      },
      options: {
        plugins: {
          legend: legendaBaixo,
          tooltip: {
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
            callbacks: {
              label: tooltipNome,
              footer: (itens) => `Total do mês: ${num(soma(itens.map((i) => i.parsed.y)))}`,
            },
          },
        },
        scales: { x: eixoX, y: { ...eixoY, grace: '12%' } },
      },
    });

    // ---- Motivos de perda: começa no modo tabela ----
    renderMapaCalor('perdas-fb-tabela', perdasFb, CORES.fb);
    renderMapaCalor('perdas-org-tabela', perdasOrg, CORES.orgCalor);
  }

  Aethos.aoCarregar(criarGraficos);
})();
