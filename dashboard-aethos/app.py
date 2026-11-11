"""
Dashboard SDR · Aethos Sistemas
--------------------------------
Páginas:
    /                       -> dashboard do mês (filtro: /?mes=2025-03)
    /visao-anual            -> consolidado do ano (filtro: /visao-anual?ano=2025)

Webhooks (o n8n envia os dados para cá):
    POST /atualizar-dados          -> grava dados.json            ({"meses": {"2026-11": {...}, ...}})
    POST /webhook/visao-anual      -> grava dados_anuais.json     ({"anos": {"2026": {...}, ...}})
    POST /webhook/analise-mensal   -> grava analise_mensal.json   (texto da IA no mensal)
    POST /webhook/analise-anual    -> grava analise_anual.json    (texto da IA no anual)

Botão "Atualizar agora" (qualquer pessoa no site pode apertar):
    POST /api/atualizar   -> chama o Webhook do n8n (variável N8N_ATUALIZAR_URL no Render)
    GET  /api/status      -> horário do último envio de cada página (o botão espera ele mudar)

Segurança opcional: se a variável de ambiente WEBHOOK_TOKEN existir no Render,
os webhooks passam a exigir o header  X-Webhook-Token: <mesmo valor>.
Sem a variável, tudo funciona como antes.
"""
import calendar
import hmac
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
ARQUIVO_MENSAL = BASE_DIR / "dados.json"
ARQUIVO_ANUAL = BASE_DIR / "dados_anuais.json"
ARQUIVO_ANALISE_MENSAL = BASE_DIR / "analise_mensal.json"
ARQUIVO_ANALISE_ANUAL = BASE_DIR / "analise_anual.json"
ARQUIVO_ATUALIZACOES = BASE_DIR / "atualizacoes.json"   # horário de cada envio do n8n
HORAS_PARA_DESATUALIZADO = 26                           # depois disso o selo fica laranja
MESES_NOMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
               "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
MESES_ABREV = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."]
FUSO_BRASILIA = timezone(timedelta(hours=-3))
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN", "").strip()

# Botão "Atualizar agora": URL do Webhook (Production URL) do n8n que roda os fluxos.
# Se o mensal e o anual estiverem em workflows separados, coloque as duas URLs separadas por vírgula.
N8N_ATUALIZAR_URLS = [u.strip() for u in os.environ.get("N8N_ATUALIZAR_URL", "").split(",") if u.strip()]
ARQUIVO_PEDIDO = BASE_DIR / "ultimo_pedido.json"   # quando o botão foi apertado pela última vez
SEGUNDOS_ENTRE_PEDIDOS = 120                        # evita que vários cliques rodem o n8n em sequência

app = Flask(__name__)

# Ícone da Aethos usado no cabeçalho e na aba do navegador.
# Para usar outro arquivo, coloque a imagem em static/img/ e troque por "/static/img/logo.png".
LOGO_URL = "https://aethossistemas.com.br/wp-content/uploads/2025/09/cropped-0bxgwtveq56-270x270.png"


@app.context_processor
def variaveis_globais():
    return {"logo_url": LOGO_URL}


# =========================================================
# DADOS DE RESERVA (usados enquanto o n8n não enviou nada)
# =========================================================
FALLBACK_MENSAL = {
    "funnel": {
        "labels": ["Leads", "Em contato", "Perdidos", "Perdidos sob controle", "Reuniões agendadas", "No-show"],
        "data": [0, 0, 0, 0, 0, 0],
    },
    "vendedores": {"labels": ["Luan", "Luiz", "Fernando", "Karine"], "data": [0, 0, 0, 0]},
    "perdas_split": {"labels": [], "facebook_data": [], "organico_data": []},
    "origens": {"labels": ["Facebook Ads", "Orgânico"], "data": [0, 0]},
    "qualidade_split": {
        "labels": ["1 Estrela", "2 Estrelas", "3 Estrelas", "4 Estrelas", "5 Estrelas"],
        "facebook_data": [0, 0, 0, 0, 0],
        "organico_data": [0, 0, 0, 0, 0],
    },
}

FALLBACK_ANUAL = {
    "labels_meses": ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
    "total_leads": {"facebook": [], "organico": [], "total": []},
    "qualidade_fb": {"1_estrela": [], "2_estrelas": [], "3_estrelas": [], "4_estrelas": [], "5_estrelas": []},
    "qualidade_org": {"1_estrela": [], "2_estrelas": [], "3_estrelas": [], "4_estrelas": [], "5_estrelas": []},
    "perdas_fb": [],
    "perdas_org": [],
    "vendedores": {"Luan": [], "Luiz": [], "Fernando": [], "Karine": []},
}


# =========================================================
# FUNÇÕES AUXILIARES
# =========================================================
def ler_json(caminho: Path, padrao: dict) -> dict:
    """Lê um arquivo JSON; se não existir ou estiver corrompido, devolve o padrão."""
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return padrao


def salvar_json(caminho: Path, dados: dict) -> None:
    """Grava em um arquivo temporário e troca no final: a página nunca lê um arquivo pela metade."""
    temporario = caminho.with_suffix(".tmp")
    with open(temporario, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=4)
    os.replace(temporario, caminho)


def token_valido() -> bool:
    if not WEBHOOK_TOKEN:
        return True
    enviado = request.headers.get("X-Webhook-Token", "")
    return hmac.compare_digest(enviado, WEBHOOK_TOKEN)


def registrar_atualizacao(chave: str) -> None:
    """Guarda o horário (UTC) em que o n8n enviou os dados de 'mensal' ou 'anual'."""
    registro = ler_json(ARQUIVO_ATUALIZACOES, {})
    registro[chave] = datetime.now(timezone.utc).isoformat()
    salvar_json(ARQUIVO_ATUALIZACOES, registro)


def normalizar_analise(pacote):
    """
    Aceita o que o n8n mandar e devolve sempre o mesmo formato:
      {"resumo": str, "destaques": [...], "alertas": [...], "recomendacoes": [...], "gerado_em": str}

    Formatos aceitos:
      1. O objeto pronto: {"resumo": "...", "destaques": [...], ...}
      2. A saída crua do Basic LLM Chain: {"text": "<JSON, com ou sem ```json```>"}
      3. Texto livre em "text": vira o resumo.
    """
    if not isinstance(pacote, dict):
        return None

    texto = pacote.get("text") or pacote.get("output")
    if isinstance(texto, str) and "resumo" not in pacote:
        limpo = re.sub(r"^```(?:json)?|```$", "", texto.strip(), flags=re.IGNORECASE).strip()
        try:
            pacote = json.loads(limpo)
        except json.JSONDecodeError:
            pacote = {"resumo": limpo}
        if not isinstance(pacote, dict):
            return None

    def lista(chave):
        valor = pacote.get(chave) or []
        if isinstance(valor, str):
            valor = [valor]
        return [str(item).strip() for item in valor if str(item).strip()][:6]

    analise = {
        "resumo": str(pacote.get("resumo") or "").strip(),
        "destaques": lista("destaques"),
        "alertas": lista("alertas"),
        "recomendacoes": lista("recomendacoes"),
        "gerado_em": datetime.now(FUSO_BRASILIA).strftime("%d/%m/%Y às %H:%M"),
    }
    if not any([analise["resumo"], analise["destaques"], analise["alertas"], analise["recomendacoes"]]):
        return None
    return analise


def receber_analise(caminho: Path):
    if not token_valido():
        return jsonify({"erro": "Token inválido ou ausente (header X-Webhook-Token)"}), 401

    analise = normalizar_analise(request.get_json(force=True, silent=True))
    if not analise:
        return jsonify({"erro": "Análise vazia ou em formato não reconhecido"}), 400

    try:
        salvar_json(caminho, analise)
    except Exception as e:
        return jsonify({"erro_interno": str(e)}), 500

    return jsonify({"status": "sucesso", "mensagem": "Análise gravada!", "analise": analise}), 200


def tempo_relativo(delta: timedelta) -> str:
    minutos = int(delta.total_seconds() // 60)
    if minutos < 1:
        return "agora"
    if minutos < 60:
        return f"há {minutos} min"
    horas = minutos // 60
    if horas < 24:
        return f"há {horas} h"
    dias = horas // 24
    return f"há {dias} dia" if dias == 1 else f"há {dias} dias"


def status_atualizacao(chave: str, arquivo: Path) -> dict:
    """
    Monta o selo do cabeçalho:
      ok           -> verde   "Atualizado há 2 h"
      antigo       -> laranja "Desatualizado · há 3 dias"
      vazio        -> cinza   "Aguardando dados"
      sem_registro -> verde   dados existem, mas chegaram antes deste recurso existir
    """
    if not arquivo.exists():
        return {"estado": "vazio", "rotulo": "Aguardando dados", "valor": "sem envio do n8n", "momento": None}

    iso = ler_json(ARQUIVO_ATUALIZACOES, {}).get(chave)
    if not iso:
        return {"estado": "sem_registro", "rotulo": "Dados carregados", "valor": "horário não registrado", "momento": None}

    momento = datetime.fromisoformat(iso)
    delta = datetime.now(timezone.utc) - momento
    local = momento.astimezone(FUSO_BRASILIA)
    valor = local.strftime("%d/%m às %H:%M")
    if delta > timedelta(hours=HORAS_PARA_DESATUALIZADO):
        return {"estado": "antigo", "rotulo": f"Desatualizado · {tempo_relativo(delta)}", "valor": valor, "momento": local}
    return {"estado": "ok", "rotulo": f"Atualizado {tempo_relativo(delta)}", "valor": valor, "momento": local}


# =========================================================
# VÁRIOS MESES E VÁRIOS ANOS
# =========================================================
def chave_do_mes(data: datetime) -> str:
    return f"{data.year}-{data.month:02d}"


def titulo_do_mes(chave: str) -> str:
    ano, mes = chave.split("-")
    return f"{MESES_NOMES[int(mes) - 1]} {ano}"


def pacote_mensal() -> dict:
    """
    Devolve {"meses": {"2026-11": {...}, ...}, "mes_atual": "2026-11"}.
    Aceita também o formato antigo (um mês só, com "funnel" na raiz):
    ele vira o mês atual, até o n8n novo enviar todos os meses.
    """
    bruto = ler_json(ARQUIVO_MENSAL, None)
    if not isinstance(bruto, dict):
        return {"meses": {}, "mes_atual": None}
    if isinstance(bruto.get("meses"), dict):
        meses = {k: v for k, v in bruto["meses"].items() if re.fullmatch(r"\d{4}-\d{2}", k) and isinstance(v, dict)}
        return {"meses": meses, "mes_atual": bruto.get("mes_atual")}
    if "funnel" in bruto:
        chave = chave_do_mes(datetime.now(FUSO_BRASILIA))
        return {"meses": {chave: bruto}, "mes_atual": chave}
    return {"meses": {}, "mes_atual": None}


def pacote_anual() -> dict:
    """Devolve {"anos": {"2026": {...}, ...}, "ano_atual": "2026"} (aceita o formato antigo de um ano só)."""
    bruto = ler_json(ARQUIVO_ANUAL, None)
    if not isinstance(bruto, dict):
        return {"anos": {}, "ano_atual": None}
    if isinstance(bruto.get("anos"), dict):
        anos = {str(k): v for k, v in bruto["anos"].items() if re.fullmatch(r"\d{4}", str(k)) and isinstance(v, dict)}
        return {"anos": anos, "ano_atual": str(bruto.get("ano_atual") or "")}
    if "total_leads" in bruto:
        ano = str(datetime.now(FUSO_BRASILIA).year)
        return {"anos": {ano: bruto}, "ano_atual": ano}
    return {"anos": {}, "ano_atual": None}


def escolher(pedido, disponiveis, padrao):
    """Usa o período pedido na URL; se não existir, o atual; senão, o mais recente."""
    if pedido in disponiveis:
        return pedido
    if padrao in disponiveis:
        return padrao
    return max(disponiveis) if disponiveis else None


def opcoes_de_meses(meses: dict) -> list:
    """Lista para o filtro, do mais recente para o mais antigo, agrupada por ano."""
    grupos = {}
    for chave in sorted(meses, reverse=True):
        grupos.setdefault(chave[:4], []).append({"chave": chave, "titulo": meses[chave].get("titulo") or titulo_do_mes(chave)})
    return [{"ano": ano, "meses": itens} for ano, itens in grupos.items()]


def comparativo_mes_anterior(meses: dict, chave: str, em_andamento: bool, momento_dados):
    """
    Compara o mês escolhido com o mês anterior (inclusive dezembro do ano anterior).
    Mês em andamento: o JS compara a PROJEÇÃO do mês (ritmo diário até o dia do
    último envio) com o total fechado do mês anterior.
    Mês fechado: compara os números finais.
    """
    ano, mes = (int(p) for p in chave.split("-"))
    ano_ant, mes_ant = (ano, mes - 1) if mes > 1 else (ano - 1, 12)
    anterior = meses.get(f"{ano_ant}-{mes_ant:02d}")
    if not anterior:
        return None

    def etapa(dados, trecho):
        funil = dados.get("funnel") or {}
        for rotulo, valor in zip(funil.get("labels") or [], funil.get("data") or []):
            if trecho in str(rotulo).lower():
                try:
                    return float(valor or 0)
                except (TypeError, ValueError):
                    return 0.0
        return 0.0

    leads = etapa(anterior, "lead")
    if not leads:
        return None

    nome = MESES_ABREV[mes_ant - 1] + ("" if ano_ant == ano else f" {ano_ant}")
    dias_no_mes = calendar.monthrange(ano, mes)[1]
    referencia = momento_dados or datetime.now(FUSO_BRASILIA)
    fechado = not em_andamento or chave_do_mes(referencia) != chave
    return {
        "mes_anterior": nome,
        "leads": leads,
        "reunioes": etapa(anterior, "reuni"),
        "fechado": fechado,
        "dia": dias_no_mes if fechado else referencia.day,
        "dias_no_mes": dias_no_mes,
    }


def receber_pacote(caminho: Path, chave_lista: str, mensagem_ok: str, chave: str):
    """
    Webhook do mensal/anual. Aceita o formato novo ({"meses": {...}} ou {"anos": {...}})
    e o antigo (um período só). No formato novo, só grava se vier pelo menos um período.
    """
    if not token_valido():
        return jsonify({"erro": "Token inválido ou ausente (header X-Webhook-Token)"}), 401

    dados = request.get_json(force=True, silent=True)
    if not dados or not isinstance(dados, dict):
        return jsonify({"erro": "Nenhum dado enviado ou JSON inválido"}), 400
    if chave_lista in dados and not (isinstance(dados[chave_lista], dict) and dados[chave_lista]):
        return jsonify({"erro": f"'{chave_lista}' veio vazio; nada foi gravado para não zerar o painel"}), 400

    try:
        salvar_json(caminho, dados)
        registrar_atualizacao(chave)
    except Exception as e:  # devolve o erro exato para o n8n
        return jsonify({"erro_interno": str(e)}), 500

    total = len(dados[chave_lista]) if chave_lista in dados else 1
    return jsonify({"status": "sucesso", "mensagem": mensagem_ok, "periodos": total}), 200


def disparar_n8n() -> list:
    """Chama cada Webhook do n8n e devolve a lista de erros (vazia se deu tudo certo)."""
    erros = []
    for url in N8N_ATUALIZAR_URLS:
        cabecalhos = {"Content-Type": "application/json"}
        if WEBHOOK_TOKEN:
            cabecalhos["X-Webhook-Token"] = WEBHOOK_TOKEN   # o mesmo token que o n8n já usa para enviar
        pedido = urllib.request.Request(url, data=b'{"origem": "botao-site"}', headers=cabecalhos, method="POST")
        try:
            with urllib.request.urlopen(pedido, timeout=20):
                pass
        except urllib.error.HTTPError as e:
            erros.append(f"o n8n respondeu {e.code}")
        except Exception as e:  # sem internet, URL errada, n8n fora do ar...
            erros.append(f"não foi possível falar com o n8n ({e.__class__.__name__})")
    return erros


# =========================================================
# PÁGINAS
# =========================================================
@app.route("/")
def dashboard():
    status = status_atualizacao("mensal", ARQUIVO_MENSAL)
    pacote = pacote_mensal()
    meses = pacote["meses"]
    atual = pacote["mes_atual"] or chave_do_mes(datetime.now(FUSO_BRASILIA))
    escolhido = escolher(request.args.get("mes"), meses, atual)
    em_andamento = escolhido == atual
    return render_template(
        "index.html",
        pagina="mensal",
        tem_dados=bool(escolhido),
        dados=meses.get(escolhido, FALLBACK_MENSAL),
        filtro=opcoes_de_meses(meses),
        escolhido=escolhido,
        titulo_periodo=titulo_do_mes(escolhido) if escolhido else "",
        em_andamento=em_andamento,
        # a análise da IA fala do mês atual, então só aparece nele
        analise=ler_json(ARQUIVO_ANALISE_MENSAL, None) if em_andamento else None,
        status=status,
        comparativo=comparativo_mes_anterior(meses, escolhido, em_andamento, status["momento"]) if escolhido else None,
    )


@app.route("/visao-anual")
def visao_anual():
    pacote = pacote_anual()
    anos = pacote["anos"]
    atual = pacote["ano_atual"] or str(datetime.now(FUSO_BRASILIA).year)
    escolhido = escolher(request.args.get("ano"), anos, atual)
    return render_template(
        "visao_anual.html",
        pagina="anual",
        tem_dados=bool(escolhido),
        dados_anuais=anos.get(escolhido, FALLBACK_ANUAL),
        anos=sorted(anos, reverse=True),
        escolhido=escolhido,
        em_andamento=escolhido == atual,
        analise=ler_json(ARQUIVO_ANALISE_ANUAL, None) if escolhido == atual else None,
        status=status_atualizacao("anual", ARQUIVO_ANUAL),
    )


@app.route("/health")
def health():
    """Rota leve para o 'ping' do n8n manter o Render acordado."""
    return jsonify({"status": "ok"}), 200


# =========================================================
# BOTÃO "ATUALIZAR AGORA"
# =========================================================
@app.route("/api/status")
def api_status():
    """Horário (UTC) do último envio do n8n de cada página. O botão compara antes e depois."""
    return jsonify(ler_json(ARQUIVO_ATUALIZACOES, {})), 200


@app.route("/api/atualizar", methods=["POST"])
def api_atualizar():
    if not N8N_ATUALIZAR_URLS:
        return jsonify({"erro": "O botão ainda não foi configurado (falta a variável N8N_ATUALIZAR_URL no Render)."}), 503

    # Se alguém apertou há pouco, não roda de novo: só espera o envio que já está a caminho
    ultimo = ler_json(ARQUIVO_PEDIDO, {}).get("em")
    if ultimo:
        passados = (datetime.now(timezone.utc) - datetime.fromisoformat(ultimo)).total_seconds()
        if passados < SEGUNDOS_ENTRE_PEDIDOS:
            return jsonify({"status": "em_andamento", "aguarde": int(SEGUNDOS_ENTRE_PEDIDOS - passados)}), 200

    salvar_json(ARQUIVO_PEDIDO, {"em": datetime.now(timezone.utc).isoformat()})
    erros = disparar_n8n()
    if erros:
        salvar_json(ARQUIVO_PEDIDO, {})   # libera um novo clique, já que este não funcionou
        return jsonify({"erro": "Não foi possível iniciar a atualização: " + "; ".join(erros) + "."}), 502

    return jsonify({"status": "disparado"}), 200


# =========================================================
# WEBHOOKS (o n8n injeta os dados aqui)
# =========================================================
@app.route("/atualizar-dados", methods=["POST"])
def atualizar_dados():
    return receber_pacote(ARQUIVO_MENSAL, "meses", "Dados gravados!", "mensal")


@app.route("/webhook/visao-anual", methods=["POST"])
def webhook_visao_anual():
    return receber_pacote(ARQUIVO_ANUAL, "anos", "Dados anuais gravados!", "anual")


@app.route("/webhook/analise-mensal", methods=["POST"])
def webhook_analise_mensal():
    return receber_analise(ARQUIVO_ANALISE_MENSAL)


@app.route("/webhook/analise-anual", methods=["POST"])
def webhook_analise_anual():
    return receber_analise(ARQUIVO_ANALISE_ANUAL)


if __name__ == "__main__":
    # Para rodar localmente: python app.py  ->  http://127.0.0.1:5000
    app.run(debug=True)
