/* =========================================================
   dashboard.js — página mensal
   ========================================================= */
(() => {
  const { CORES, PLUGINS, num, soma, pct, paraNumeros, rotulo } = Aethos;

  Aethos.preencherRodape();

  const dados = Aethos.lerDados('dados-mensal');
  if (!dados) return;


  // ---------------------------------------------------------
  // 1. FUNIL — busca cada etapa pelo nome (se a ordem mudar no n8n, continua certo)
  // ---------------------------------------------------------
  const funilLabels = dados.funnel?.labels || [];
  const funilValores = paraNumeros(dados.funnel?.data);

  const etapa = (trecho, indiceReserva) => {
    const i = funilLabels.findIndex((l) => l.toLowerCase().includes(trecho));
    return funilValores[i >= 0 ? i : indiceReserva] || 0;
  };

  const totalLeads = etapa('lead', 0);
  const emContato = etapa('contato', 1);
  const perdidos = funilValores[funilLabels.findIndex((l) => l.toLowerCase() === 'perdidos')] ?? funilValores[2] ?? 0;
  const reunioes = etapa('reuni', 4);
  const noshow = etapa('no-show', 5);

  // ---------------------------------------------------------
  // 2. COMPARAÇÃO COM O MÊS ANTERIOR
  //    O mês atual ainda não fechou: comparamos a PROJEÇÃO do mês
  //    (ritmo por dia × dias do mês) com o total do mês anterior.
  // ---------------------------------------------------------
  const comp = Aethos.lerDados('comparativo');
  const podeComparar = comp && comp.dia >= 3; // com 1 ou 2 dias a projeção ainda é instável
  const projetar = (valorAtual) => Math.round((valorAtual / comp.dia) * comp.dias_no_mes);

  const variacao = (atual, anterior) => {
    if (!anterior) return null;
    const v = ((atual - anterior) / anterior) * 100;
    const tipo = Math.abs(v) < 1 ? 'neutro' : v > 0 ? 'sobe' : 'desce';
    return { tipo, texto: `${Math.abs(v).toFixed(0)}% vs ${comp.mes_anterior}` };
  };

  const deltaProjetado = (valorAtual, anterior, nome) => {
    if (!podeComparar) return null;
    const projecao = projetar(valorAtual);
    const v = variacao(projecao, anterior);
    if (!v) return null;
    return {
      ...v,
      detalhe: `projeção do mês: ${num(projecao)}`,
      titulo: `No ritmo atual, o mês deve fechar com ${num(projecao)} ${nome}. ` +
              `Em ${comp.mes_anterior} foram ${num(anterior)}.`,
    };
  };

  let deltaTaxa = null;
  if (podeComparar && comp.leads) {
    const taxaAtual = totalLeads ? (reunioes / totalLeads) * 100 : 0;
    const taxaAnterior = (comp.reunioes / comp.leads) * 100;
    const pp = taxaAtual - taxaAnterior;
    deltaTaxa = {
      tipo: Math.abs(pp) < 0.5 ? 'neutro' : pp > 0 ? 'sobe' : 'desce',
      texto: `${Math.abs(pp).toFixed(1).replace('.', ',')} p.p. vs ${comp.mes_anterior}`,
      detalhe: '',
      titulo: `Em ${comp.mes_anterior} a taxa foi ${taxaAnterior.toFixed(1).replace('.', ',')}%.`,
    };
  }

  // ---------------------------------------------------------
  // 3. KPIs
  // ---------------------------------------------------------
  Aethos.renderKpis(document.getElementById('kpi-strip'), [
    { rotulo: 'Total de leads', valor: num(totalLeads), sub: 'base do funil', cor: 'marinho',
      delta: deltaProjetado(totalLeads, comp?.leads, 'leads') },
    { rotulo: 'Em contato', valor: num(emContato), sub: `${pct(emContato, totalLeads)} dos leads`, cor: 'azul' },
    { rotulo: 'Perdidos', valor: num(perdidos), sub: `${pct(perdidos, totalLeads)} dos leads`, cor: 'vermelho' },
    { rotulo: 'Reuniões agendadas', valor: num(reunioes), sub: `${num(Math.max(reunioes - noshow, 0))} sem no-show`, cor: 'verde',
      delta: deltaProjetado(reunioes, comp?.reunioes, 'reuniões') },
    { rotulo: 'No-show', valor: num(noshow), sub: `${pct(noshow, reunioes)} das reuniões`, cor: 'ambar' },
    { rotulo: 'Taxa de conversão', valor: pct(reunioes, totalLeads), sub: 'reuniões ÷ leads', cor: 'marinho',
      delta: deltaTaxa },
  ]);
  document.getElementById('pill-total-leads').textContent = num(totalLeads);

  // ---------------------------------------------------------
  // 4. GRÁFICOS
  // ---------------------------------------------------------
  const corEtapa = (label) => {
    const l = label.toLowerCase();
    if (l.includes('no-show') || l.includes('no show')) return CORES.ambar;
    if (l.includes('reuni')) return CORES.verde;
    if (l.includes('sob controle')) return '#F4A6A8';
    if (l.includes('perdid')) return CORES.vermelho;
    if (l.includes('contato')) return CORES.fb;
    return CORES.primaria;
  };

  const eixoValores = { grid: { color: CORES.grade }, border: { display: false }, ticks: { precision: 0 } };
  const eixoCategorias = { grid: { display: false }, border: { display: false }, ticks: { color: CORES.texto2, font: { weight: '500' } } };

  function criarGraficos() {
    Aethos.configurarChartJs();

    // ---- Funil (barras horizontais com valor e % do total) ----
    new Chart(document.getElementById('chartFunil'), {
      type: 'bar',
      plugins: PLUGINS,
      data: {
        labels: funilLabels,
        datasets: [{
          label: 'Quantidade',
          data: funilValores,
          backgroundColor: funilLabels.map(corEtapa),
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 30,
        }],
      },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 90 } },
        interaction: { mode: 'nearest', axis: 'y', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${num(ctx.parsed.x)} leads (${pct(ctx.parsed.x, totalLeads)} do total)`,
            },
          },
          datalabels: rotulo({
            anchor: 'end',
            align: 'end',
            offset: 6,
            font: { family: "'DM Mono', monospace", weight: '500', size: 12 },
            formatter: (v, ctx) => (ctx.dataIndex === 0 ? num(v) : `${num(v)}  (${pct(v, totalLeads)})`),
          }),
        },
        scales: { x: eixoValores, y: eixoCategorias },
      },
    });

    // ---- Vendedores ----
    const vendLabels = dados.vendedores?.labels || [];
    const vendValores = paraNumeros(dados.vendedores?.data);
    const totalVend = soma(vendValores);
    document.getElementById('pill-total-reunioes').textContent = num(totalVend);

    new Chart(document.getElementById('chartVendedores'), {
      type: 'bar',
      plugins: PLUGINS,
      data: {
        labels: vendLabels,
        datasets: [{
          label: 'Reuniões agendadas',
          data: vendValores,
          backgroundColor: vendLabels.map((_, i) => CORES.vendedores[i % CORES.vendedores.length]),
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 56,
        }],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => ` ${num(ctx.parsed.y)} reuniões (${pct(ctx.parsed.y, totalVend)})` },
          },
          datalabels: rotulo({
            anchor: 'end',
            align: 'top',
            offset: 2,
            formatter: (v) => `${num(v)} (${pct(v, totalVend, 0)})`,
          }),
        },
        scales: {
          x: { ...eixoCategorias, ticks: { color: CORES.texto2, font: { weight: '600', size: 13 } } },
          y: { ...eixoValores, grace: '18%' },
        },
      },
    });

    // ---- Origens (rosca com número e % em cada fatia + total no centro) ----
    const origLabels = dados.origens?.labels || [];
    const origValores = paraNumeros(dados.origens?.data);
    const totalOrig = soma(origValores);
    const coresOrigem = origLabels.map((l, i) => {
      const t = l.toLowerCase();
      if (t.includes('face') || t.includes('ads')) return CORES.fb;
      if (t.includes('org')) return CORES.org;
      return CORES.vendedores[i % CORES.vendedores.length];
    });

    new Chart(document.getElementById('chartOrigens'), {
      type: 'doughnut',
      plugins: [...PLUGINS, Aethos.pluginTextoCentral],
      data: {
        labels: origLabels,
        datasets: [{
          data: origValores,
          backgroundColor: coresOrigem,
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 8,
        }],
      },
      options: {
        cutout: '58%',
        interaction: { mode: 'nearest', intersect: true },
        plugins: {
          textoCentral: { valor: num(totalOrig), rotulo: 'leads' },
          legend: {
            position: window.innerWidth < 640 ? 'bottom' : 'right',
            labels: {
              padding: 18,
              font: { size: 13, weight: '500' },
              generateLabels: (chart) => chart.data.labels.map((label, i) => ({
                text: `${label}: ${num(origValores[i])} (${pct(origValores[i], totalOrig)})`,
                fillStyle: coresOrigem[i],
                strokeStyle: coresOrigem[i],
                pointStyle: 'circle',
                hidden: !chart.getDataVisibility(i),
                index: i,
              })),
            },
          },
          tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.label}: ${num(ctx.parsed)} leads (${pct(ctx.parsed, totalOrig)})` },
          },
          datalabels: rotulo({
            color: (ctx) => Aethos.textoSobre(coresOrigem[ctx.dataIndex]),
            textAlign: 'center',
            font: { family: "'DM Mono', monospace", weight: '500', size: 12 },
            display: (ctx) => totalOrig > 0 && ctx.dataset.data[ctx.dataIndex] / totalOrig >= 0.07,
            formatter: (v) => [num(v), pct(v, totalOrig, 0)],
          }),
        },
      },
    });

    // ---- Motivos de perda (barras horizontais, do maior para o menor) ----
    const perdLabels = dados.perdas_split?.labels || [];
    const perdFb = paraNumeros(dados.perdas_split?.facebook_data);
    const perdOrg = paraNumeros(dados.perdas_split?.organico_data);
    const perdas = perdLabels
      .map((label, i) => ({ label, fb: perdFb[i] || 0, org: perdOrg[i] || 0 }))
      .sort((a, b) => (b.fb + b.org) - (a.fb + a.org));

    Aethos.renderLegenda(document.getElementById('legend-perdas'), [
      { cor: CORES.fb, rotulo: 'Facebook Ads', valor: num(soma(perdFb)) },
      { cor: CORES.org, rotulo: 'Orgânico', valor: num(soma(perdOrg)) },
    ]);
    // A altura cresce conforme a quantidade de motivos
    document.getElementById('box-perdas').style.setProperty('--h', `${Math.max(240, perdas.length * 58)}px`);

    const rotuloPerda = (cor) => rotulo({
      anchor: 'end', align: 'end', offset: 4, color: cor,
      display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
      formatter: (v) => num(v),
    });

    new Chart(document.getElementById('chartPerdas'), {
      type: 'bar',
      plugins: PLUGINS,
      data: {
        labels: perdas.map((p) => p.label),
        datasets: [
          { label: 'Facebook Ads', data: perdas.map((p) => p.fb), backgroundColor: CORES.fb, borderRadius: 5, borderSkipped: false, maxBarThickness: 22, datalabels: rotuloPerda(CORES.fb) },
          { label: 'Orgânico', data: perdas.map((p) => p.org), backgroundColor: CORES.org, borderRadius: 5, borderSkipped: false, maxBarThickness: 22, datalabels: rotuloPerda(CORES.orgTexto) },
        ],
      },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 32 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${num(ctx.parsed.x)} leads`,
              footer: (itens) => `Total: ${num(soma(itens.map((i) => i.parsed.x)))} leads`,
            },
          },
        },
        scales: { x: eixoValores, y: eixoCategorias },
      },
    });

    // ---- Qualidade (estrelas) ----
    const qualLabels = dados.qualidade_split?.labels || [];
    const qualFb = paraNumeros(dados.qualidade_split?.facebook_data);
    const qualOrg = paraNumeros(dados.qualidade_split?.organico_data);
    const media = (arr) => {
      const n = soma(arr);
      return n ? (arr.reduce((acc, v, i) => acc + v * (i + 1), 0) / n).toFixed(1).replace('.', ',') : '–';
    };

    Aethos.renderLegenda(document.getElementById('legend-qualidade'), [
      { cor: CORES.fb, rotulo: 'Facebook Ads', valor: `${num(soma(qualFb))} leads · média ${media(qualFb)} ★` },
      { cor: CORES.org, rotulo: 'Orgânico', valor: `${num(soma(qualOrg))} leads · média ${media(qualOrg)} ★` },
    ]);

    const rotuloTopo = (cor) => rotulo({
      anchor: 'end', align: 'top', offset: 2, color: cor,
      display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
      formatter: (v) => num(v),
    });

    new Chart(document.getElementById('chartQualidade'), {
      type: 'bar',
      plugins: PLUGINS,
      data: {
        labels: qualLabels,
        datasets: [
          { label: 'Facebook Ads', data: qualFb, backgroundColor: CORES.fb, borderRadius: 5, borderSkipped: false, maxBarThickness: 40, datalabels: rotuloTopo(CORES.fb) },
          { label: 'Orgânico', data: qualOrg, backgroundColor: CORES.org, borderRadius: 5, borderSkipped: false, maxBarThickness: 40, datalabels: rotuloTopo(CORES.orgTexto) },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const totalCanal = soma(ctx.dataset.data);
                return ` ${ctx.dataset.label}: ${num(ctx.parsed.y)} leads (${pct(ctx.parsed.y, totalCanal)} do canal)`;
              },
            },
          },
        },
        scales: {
          x: { ...eixoCategorias, ticks: { color: CORES.texto2, font: { weight: '500', size: 12 } } },
          y: { ...eixoValores, grace: '15%' },
        },
      },
    });
  }

  Aethos.aoCarregar(criarGraficos);
})();
