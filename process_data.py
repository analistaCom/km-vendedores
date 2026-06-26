import pandas as pd
import numpy as np
import json
import os
import math

def haversine(lat1, lon1, lat2, lon2):
    """Calcula a distância em quilômetros entre dois pontos usando a fórmula de Haversine."""
    R = 6371.0 # Raio da Terra em km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlon / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def calculate_route_distance(coords, path):
    """Calcula a distância total de uma rota especificada pelos índices do path."""
    dist = 0.0
    for i in range(len(path) - 1):
        idx1 = path[i]
        idx2 = path[i+1]
        dist += haversine(coords[idx1][0], coords[idx1][1], coords[idx2][0], coords[idx2][1])
    return dist

def solve_tsp_exact(coords):
    """Resolve o TSP exatamente usando Programação Dinâmica (Held-Karp). Adequado para N <= 10."""
    n = len(coords)
    if n <= 1:
        return [0], 0.0
    if n == 2:
        d = haversine(coords[0][0], coords[0][1], coords[1][0], coords[1][1])
        return [0, 1], d

    # Matriz de distâncias
    dist_matrix = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            dist_matrix[i][j] = haversine(coords[i][0], coords[i][1], coords[j][0], coords[j][1])

    memo = {}

    def get_tsp(mask, last):
        if mask == (1 << n) - 1:
            memo[(mask, last)] = (0.0, -1)
            return 0.0, -1
        if (mask, last) in memo:
            return memo[(mask, last)]
        
        min_d = float('inf')
        best_next = -1
        for next_node in range(n):
            if not (mask & (1 << next_node)):
                d, _ = get_tsp(mask | (1 << next_node), next_node)
                total_d = dist_matrix[last][next_node] + d
                if total_d < min_d:
                    min_d = total_d
                    best_next = next_node
        
        memo[(mask, last)] = (min_d, best_next)
        return min_d, best_next

    min_d = float('inf')
    best_start = -1
    for start in range(n):
        d, nxt = get_tsp(1 << start, start)
        if d < min_d:
            min_d = d
            best_start = start

    # Reconstrói o caminho
    path = [best_start]
    mask = 1 << best_start
    curr = best_start
    while True:
        _, nxt = memo[(mask, curr)]
        if nxt == -1:
            break
        path.append(nxt)
        mask |= (1 << nxt)
        curr = nxt

    return path, min_d

def solve_tsp_2opt(coords, max_starts=5):
    """Resolve o TSP de forma aproximada e muito rápida usando 2-opt. Adequado para N > 10."""
    n = len(coords)
    if n <= 1:
        return [0], 0.0
    if n == 2:
        d = haversine(coords[0][0], coords[0][1], coords[1][0], coords[1][1])
        return [0, 1], d

    best_path = None
    best_dist = float('inf')

    # Multi-start para evitar mínimos locais
    for start_node in range(min(max_starts, n)):
        # Heurística do Vizinho Mais Próximo para gerar rota inicial
        unvisited = set(range(n))
        curr = start_node
        unvisited.remove(curr)
        path = [curr]
        
        while unvisited:
            next_node = min(unvisited, key=lambda x: haversine(coords[curr][0], coords[curr][1], coords[x][0], coords[x][1]))
            path.append(next_node)
            unvisited.remove(next_node)
            curr = next_node

        # Refinamento 2-opt
        improved = True
        while improved:
            improved = False
            for i in range(1, n - 1):
                for j in range(i + 1, n):
                    # Tenta inverter o segmento entre i e j
                    new_path = path[:i] + list(reversed(path[i:j+1])) + path[j+1:]
                    d_orig = calculate_route_distance(coords, path)
                    d_new = calculate_route_distance(coords, new_path)
                    if d_new < d_orig:
                        path = new_path
                        improved = True
        
        d_final = calculate_route_distance(coords, path)
        if d_final < best_dist:
            best_dist = d_final
            best_path = path

    return best_path, best_dist

def solve_tsp(coords):
    """Escolhe o melhor algoritmo de acordo com o número de coordenadas."""
    if len(coords) <= 10:
        return solve_tsp_exact(coords)
    else:
        return solve_tsp_2opt(coords)

def get_week_label(date_val):
    """Gera uma etiqueta amigável em português para a semana do ano."""
    # Segunda e Domingo correspondentes
    monday = date_val - pd.Timedelta(days=date_val.weekday())
    sunday = monday + pd.Timedelta(days=6)
    week_num = date_val.isocalendar().week
    return f"Semana {week_num:02d} ({monday.strftime('%d/%m')} a {sunday.strftime('%d/%m')})"

def clean_outliers(df):
    """Corrige coordenadas que estão a mais de 150 km da mediana diária do vendedor."""
    cleaned_df = df.copy()
    outliers_count = 0
    
    for (vend, dia), group in cleaned_df.groupby(['VEND', 'DIA']):
        if len(group) <= 1:
            continue
        
        med_lat = group['LATITUDE'].median()
        med_lon = group['LONGITUDE'].median()
        
        # Identifica coordenadas cuja distância para a mediana diária supera 150 km
        for idx, row in group.iterrows():
            lat = row['LATITUDE']
            lon = row['LONGITUDE']
            dist = haversine(lat, lon, med_lat, med_lon)
            
            if dist > 150.0:
                outliers_count += 1
                
                # Encontra outros pontos válidos do mesmo dia para calcular a mediana
                other_points = group[group.index != idx]
                if len(other_points) > 0:
                    new_lat = other_points['LATITUDE'].median()
                    new_lon = other_points['LONGITUDE'].median()
                else:
                    new_lat = med_lat
                    new_lon = med_lon
                
                print(f"Corrigindo outlier de geolocalização para '{vend}' em {dia.strftime('%d/%m/%Y')} (Cliente: {row['CLIENTE']}):")
                print(f"  Coordenadas originais: ({lat:.6f}, {lon:.6f})")
                print(f"  Novas coordenadas (mediana diária): ({new_lat:.6f}, {new_lon:.6f})")
                print(f"  Distância errônea detectada: {dist:.1f} km")
                
                cleaned_df.at[idx, 'LATITUDE'] = new_lat
                cleaned_df.at[idx, 'LONGITUDE'] = new_lon
                
    print(f"Total de coordenadas corrigidas (outliers): {outliers_count}")
    return cleaned_df

def format_cnpj(cnpj_val):
    """Formata o CNPJ para exibição amigável."""
    # Converte para string e remove decimais de floats
    s = str(cnpj_val).strip()
    if s.endswith('.0'):
        s = s[:-2]
    # Remove qualquer notação científica se necessário
    if 'e+' in s.lower() or 'E+' in s.lower():
        try:
            s = str(int(float(s)))
        except:
            pass
    # Preenche com zeros à esquerda até 14 dígitos
    s = s.zfill(14)
    # Formata como XX.XXX.XXX/XXXX-XX
    if len(s) == 14:
        return f"{s[0:2]}.{s[2:5]}.{s[5:8]}/{s[8:12]}-{s[12:14]}"
    return s

def main():
    csv_file = 'Distancia_percorrida.csv'
    if not os.path.exists(csv_file):
        print(f"Erro: Arquivo '{csv_file}' não encontrado na pasta atual!")
        return

    print("Carregando arquivo CSV...")
    # Lê o CSV especificando separador e decimal
    df = pd.read_csv(csv_file, sep=';', decimal=',')
    df.dropna(subset=['VEND', 'CNPJ', 'CLIENTE', 'DIA', 'LATITUDE', 'LONGITUDE'], how='any', inplace=True)
    df = df[df['VEND'].astype(str).str.strip() != '']
    df['DIA'] = pd.to_datetime(df['DIA'], format='%d/%m/%Y')
    
    # Aplica limpeza de outliers
    print("Avaliando erros de geolocalização...")
    df_clean = clean_outliers(df)
    
    # Adiciona semanas e formatações de data
    df_clean['semana_label'] = df_clean['DIA'].apply(get_week_label)
    df_clean['dia_formatado'] = df_clean['DIA'].dt.strftime('%d/%m/%Y')
    df_clean['CNPJ_formatado'] = df_clean['CNPJ'].apply(format_cnpj)
    
    # Estrutura final dos dados
    dados_vendedores = {}
    total_km_geral = 0.0
    total_visitas_geral = 0
    dias_ativos_set = set()
    
    resumo_vendedores = {}
    
    # Agrupa por vendedor
    for vend, group_vend in df_clean.groupby('VEND'):
        vend_lower = vend.lower()
        print(f"Calculando rotas e distâncias para o vendedor: {vend_lower}...")
        
        dados_vendedores[vend_lower] = {
            "total_geral": {"km": 0.0, "visitas": 0, "dias_ativos": 0},
            "semanal": {},
            "diario": {}
        }
        
        total_km_vend = 0.0
        total_visitas_vend = len(group_vend)
        dias_ativos_vend = group_vend['dia_formatado'].nunique()
        
        # Agrupa por dia
        for dia_str, group_dia in group_vend.groupby('dia_formatado'):
            # Data real para ordenação temporal secundária
            dia_real = group_dia['DIA'].iloc[0]
            semana_lbl = group_dia['semana_label'].iloc[0]
            
            # Coleta de coordenadas e informações dos clientes
            visits_info = []
            coords = []
            for _, r in group_dia.iterrows():
                coords.append((r['LATITUDE'], r['LONGITUDE']))
                visits_info.append({
                    "cliente": r['CLIENTE'],
                    "cnpj": r['CNPJ_formatado'],
                    "tipo": r['TIPO'],
                    "lat": r['LATITUDE'],
                    "lon": r['LONGITUDE'],
                    "orig_lat": r['LATITUDE'],
                    "orig_lon": r['LONGITUDE']
                })
            
            # Resolve o TSP para ordenar a rota de forma lógica
            path, dia_dist = solve_tsp(coords)
            total_km_vend += dia_dist
            
            # Adiciona a data no conjunto global de datas ativas
            dias_ativos_set.add(dia_str)
            
            # Reconstrói a rota ordenada
            ordered_route = []
            acumulado_dist = 0.0
            
            for seq_idx, path_idx in enumerate(path):
                v_info = visits_info[path_idx]
                
                # Distância do trecho a partir da visita anterior
                if seq_idx == 0:
                    trecho_dist = 0.0
                else:
                    prev_info = ordered_route[-1]
                    trecho_dist = haversine(prev_info['lat'], prev_info['lon'], v_info['lat'], v_info['lon'])
                
                acumulado_dist += trecho_dist
                
                ordered_route.append({
                    "sequencia": seq_idx + 1,
                    "cliente": v_info['cliente'],
                    "cnpj": v_info['cnpj'],
                    "tipo": v_info['tipo'],
                    "lat": v_info['lat'],
                    "lon": v_info['lon'],
                    "km_trecho": round(trecho_dist, 2),
                    "km_acumulado": round(acumulado_dist, 2)
                })
            
            # Adiciona dados no diário
            dados_vendedores[vend_lower]["diario"][dia_str] = {
                "km": round(dia_dist, 2),
                "visitas": len(group_dia),
                "semana": semana_lbl,
                "rota": ordered_route
            }
            
            # Acumula no semanal
            if semana_lbl not in dados_vendedores[vend_lower]["semanal"]:
                dados_vendedores[vend_lower]["semanal"][semana_lbl] = {"km": 0.0, "visitas": 0}
            dados_vendedores[vend_lower]["semanal"][semana_lbl]["km"] += dia_dist
            dados_vendedores[vend_lower]["semanal"][semana_lbl]["visitas"] += len(group_dia)
            
        # Arredonda e finaliza agregados do vendedor
        dados_vendedores[vend_lower]["total_geral"]["km"] = round(total_km_vend, 2)
        dados_vendedores[vend_lower]["total_geral"]["visitas"] = total_visitas_vend
        dados_vendedores[vend_lower]["total_geral"]["dias_ativos"] = dias_ativos_vend
        
        # Arredonda valores semanais
        for sem in dados_vendedores[vend_lower]["semanal"]:
            dados_vendedores[vend_lower]["semanal"][sem]["km"] = round(dados_vendedores[vend_lower]["semanal"][sem]["km"], 2)
            
        # Adiciona ao resumo consolidado
        resumo_vendedores[vend_lower] = {
            "total_km": round(total_km_vend, 2),
            "total_visitas": total_visitas_vend,
            "total_dias_ativos": dias_ativos_vend,
            "media_km_dia": round(total_km_vend / dias_ativos_vend if dias_ativos_vend > 0 else 0, 2),
            "media_km_visita": round(total_km_vend / total_visitas_vend if total_visitas_vend > 0 else 0, 2)
        }
        
        total_km_geral += total_km_vend
        total_visitas_geral += total_visitas_vend
        
    # Listas ordenadas únicas de semanas e dias
    semanas_unicas = sorted(list(df_clean['semana_label'].unique()))
    dias_unicos = sorted(list(df_clean['dia_formatado'].unique()), key=lambda d: pd.to_datetime(d, format='%d/%m/%Y'))
    
    total_dias_ativos_geral = len(dias_ativos_set)
    
    dados_completos = {
        "resumo": {
            "total_km": round(total_km_geral, 2),
            "total_visitas": total_visitas_geral,
            "total_dias_ativos": total_dias_ativos_geral,
            "media_km_dia": round(total_km_geral / total_dias_ativos_geral if total_dias_ativos_geral > 0 else 0, 2),
            "media_km_visita": round(total_km_geral / total_visitas_geral if total_visitas_geral > 0 else 0, 2)
        },
        "vendedores": resumo_vendedores,
        "semanas": semanas_unicas,
        "dias": dias_unicos,
        "dados_por_vendedor": dados_vendedores
    }
    
    # Exporta para JSON
    print("Gravando arquivo 'data.json'...")
    with open('data.json', 'w', encoding='utf-8') as f:
        json.dump(dados_completos, f, ensure_ascii=False, indent=2)
        
    # Exporta para JS (para carregamento offline direto em index.html)
    print("Gravando arquivo 'data.js'...")
    with open('data.js', 'w', encoding='utf-8') as f:
        f.write("const DADOS_VENDEDORES = ")
        json.dump(dados_completos, f, ensure_ascii=False)
        f.write(";\n")
        
    print("Processamento concluído com sucesso!")

if __name__ == "__main__":
    main()
