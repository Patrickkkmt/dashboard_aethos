/* =========================================================
   atualizar.js — botão "Atualizar agora" do cabeçalho
   1. Pede ao site para rodar o n8n (POST /api/atualizar)
   2. Fica olhando /api/status até o n8n enviar os dados novos
   3. Recarrega a página com os números atualizados
   ========================================================= */
(() => {
  const botao = document.getElementById('btn-atualizar');
  const aviso = document.getElementById('aviso-atualizar');
  if (!botao) return;

  const texto = botao.querySelector('.btn-atualizar__texto');
  const pagina = botao.dataset.pagina;            // "mensal" ou "anual"
  const INTERVALO_MS = 5000;                      // de quanto em quanto tempo confere se chegou
  const LIMITE_MS = 4 * 60 * 1000;                // desiste depois de 4 minutos
  let timerAviso;

  function mostrarAviso(mensagem, erro = false) {
    clearTimeout(timerAviso);
    aviso.textContent = mensagem;
    aviso.classList.toggle('aviso--erro', erro);
    aviso.hidden = false;
    if (erro) timerAviso = setTimeout(() => { aviso.hidden = true; }, 8000);
  }

  function carregando(ativo) {
    botao.disabled = ativo;
    botao.classList.toggle('is-carregando', ativo);
    texto.textContent = ativo ? 'Atualizando…' : 'Atualizar agora';
  }

  async function lerStatus() {
    const resposta = await fetch('/api/status', { cache: 'no-store' });
    return resposta.ok ? resposta.json() : {};
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  botao.addEventListener('click', async () => {
    carregando(true);
    mostrarAviso('Buscando os números nas planilhas. Isso leva cerca de 1 minuto…');

    try {
      const antes = (await lerStatus())[pagina] || '';

      const resposta = await fetch('/api/atualizar', { method: 'POST' });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível iniciar a atualização.');
      if (corpo.status === 'em_andamento') {
        mostrarAviso('Alguém já pediu uma atualização agora há pouco. Aguardando os números chegarem…');
      }

      // Espera o n8n terminar e enviar os dados (o horário do último envio muda)
      const inicio = Date.now();
      while (Date.now() - inicio < LIMITE_MS) {
        await esperar(INTERVALO_MS);
        const agora = (await lerStatus())[pagina] || '';
        if (agora && agora !== antes) {
          mostrarAviso('Dados atualizados! Recarregando o painel…');
          window.location.reload();
          return;
        }
      }
      throw new Error('O n8n não enviou os dados a tempo. Confira as execuções do fluxo no n8n e tente de novo.');
    } catch (erro) {
      carregando(false);
      mostrarAviso(erro.message || 'Algo deu errado. Tente de novo em instantes.', true);
    }
  });
})();
