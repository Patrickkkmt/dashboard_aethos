Python
from flask import Flask, render_template, request, jsonify
import json
import os

app = Flask(__name__)

# =========================================================
# 1. ROTA DA PÁGINA INICIAL (DASHBOARD MENSAL)
# =========================================================
@app.route("/")
def dashboard():
    if os.path.exists('dados.json'):
        with open('dados.json', 'r', encoding='utf-8') as f:
            dados_dashboard = json.load(f)
    else:
        dados_dashboard = {
            "funnel": {"labels": ["Leads", "Em contato", "Perdidos", "Perdidos sob controle", "Reuniões agendadas", "No-show"], "data": [102, 8, 50, 11, 26, 3]},
            "vendedores": {"labels": ["Luan", "Luiz", "Fernando", "Karine"], "data": [5, 6, 10, 5]},
            "perdas_split": {"labels": ["Nossa solução não atende", "Não tem potencial financeiro", "Número inválido", "Desqualificado", "Lead Frio"], "facebook_data": [8, 2, 7, 10, 4], "organico_data": [2, 9, 3, 7, 3]},
            "origens": {"labels": ["Facebook Ads", "Orgânico"], "data": [64, 38]},
            "qualidade_split": {"labels": ["1 Estrela", "2 Estrelas", "3 Estrelas", "4 Estrelas", "5 Estrelas"], "facebook_data": [22, 0, 22, 10, 10], "organico_data": [20, 2, 12, 0, 4]}
        }
    return render_template("index.html", dados=dados_dashboard)

# =========================================================
# 2. ROTA DA PÁGINA ANUAL
# =========================================================
@app.route('/visao-anual')
def visao_anual():
    try:
        with open('dados_anuais.json', 'r') as f:
            dados_reais = json.load(f)
    except FileNotFoundError:
        # Fallback de segurança se o n8n ainda não tiver enviado nada
        dados_reais = {
            "labels_meses": ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
            "total_leads": {"facebook": [], "organico": [], "total": []},
            "qualidade_fb": {"1_estrela": [], "2_estrelas": [], "3_estrelas": [], "4_estrelas": [], "5_estrelas": []},
            "qualidade_org": {"1_estrela": [], "2_estrelas": [], "3_estrelas": [], "4_estrelas": [], "5_estrelas": []},
            "perdas_fb": [],
            "perdas_org": [],
            "vendedores": {"Luan": [], "Luiz": [], "Fernando": [], "Karine": []}
        }
    return render_template('visao_anual.html', dados_anuais=dados_reais)

# =========================================================
# 3. WEBHOOKS (ONDE O N8N INJETA OS DADOS)
# =========================================================

# Recebe os dados do mês atual
@app.route('/atualizar-dados', methods=['POST'])
def atualizar_dados():
    try:
        dados_recebidos = request.get_json()
        if not dados_recebidos:
            return jsonify({"erro": "Nenhum dado enviado"}), 400
            
        with open('dados.json', 'w', encoding='utf-8') as f:
            json.dump(dados_recebidos, f, ensure_ascii=False, indent=4)
            
        return jsonify({"status": "sucesso", "mensagem": "Dados gravados!"}), 200
    except Exception as e:
        return jsonify({"erro": str(e)}), 500

# Recebe os dados do consolidado anual
@app.route('/webhook/visao-anual', methods=['POST'])
def webhook_visao_anual():
    try:
        # get_json(force=True) obriga o Flask a ler o pacote mesmo se o n8n falhar no cabeçalho
        dados_recebidos = request.get_json(force=True)
        
        if not dados_recebidos:
            return jsonify({"erro": "Pacote vazio enviado pelo n8n"}), 400
            
        # encoding='utf-8' garante que os acentos (ã, ç) sejam salvos perfeitamente sem crashar o app
        with open('dados_anuais.json', 'w', encoding='utf-8') as f:
            json.dump(dados_recebidos, f, ensure_ascii=False, indent=4)
            
        return jsonify({"status": "sucesso", "mensagem": "Dados anuais gravados!"}), 200
        
    except Exception as e:
        # Se falhar, agora o site devolve o erro exato para o n8n em vez de uma página HTML quebrada
        return jsonify({"erro_interno": str(e)}), 500
