// ===========================================================
// VARIÁVEIS GLOBAIS DE CONTROLE
// ===========================================================
let mapInstance = null;
let routeLineGroup = null;
let markersGroup = null;
let chartInstance = null;
let activeTab = 'vendedores'; // 'vendedores' | 'semanal' | 'diario'

// Estado das Exclusões de Visitas
// Formato: { "vendedor_dia": Set(cnpj1, cnpj2, ...) }
const exclusoesVisitas = {};

// Elementos do DOM
const elVendedor = document.getElementById('filter-vendedor');
const elMes      = document.getElementById('filter-mes');
const elSemana   = document.getElementById('filter-semana');
const elDia      = document.getElementById('filter-dia');

const elKpiTotalKm      = document.getElementById('kpi-total-km');
const elKpiTotalVisitas = document.getElementById('kpi-total-visitas');
const elKpiMediaDia     = document.getElementById('kpi-media-dia');
const elKpiMediaVisita  = document.getElementById('kpi-media-visita');

const elMapBadge          = document.getElementById('map-badge');
const elRouteDetailsBadge = document.getElementById('route-details-badge');
const elRouteTableBody    = document.getElementById('route-table-body');

// Cores dos Vendedores
const CORES_VENDEDORES = {
    'aurea':    { hex: '#06b6d4', glow: 'rgba(6, 182, 212, 0.4)' },
    'marceloa': { hex: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)' },
    'roxanne':  { hex: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.4)' },
    'padrao':   { hex: '#10b981', glow: 'rgba(16, 185, 129, 0.4)' }
};

// Mapa de números de mês para nomes em português
const NOMES_MESES = {
    '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março',
    '04': 'Abril',   '05': 'Maio',      '06': 'Junho',
    '07': 'Julho',   '08': 'Agosto',    '09': 'Setembro',
    '10': 'Outubro', '11': 'Novembro',  '12': 'Dezembro'
};

// ===========================================================
// FUNÇÕES AUXILIARES DE DATA
// ===========================================================

// Extrai o mês "MM/YYYY" de uma data no formato "DD/MM/YYYY"
function obterMesDoDia(dia) {
    const partes = dia.split('/'); // [DD, MM, YYYY]
    return `${partes[1]}/${partes[2]}`; // MM/YYYY
}

// Verifica se um dia pertence ao mês selecionado
function diaNoMes(dia, mes) {
    if (mes === 'todos') return true;
    return obterMesDoDia(dia) === mes;
}

// Verifica se uma semana tem pelo menos um dia no mês selecionado
function semanaNoMes(semLabel, mes) {
    if (mes === 'todos') return true;
    // Percorre todos os dias dos dados buscando um que esteja nesta semana e neste mês
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor;
    for (const v of Object.keys(dadosVend)) {
        for (const d of Object.keys(dadosVend[v].diario)) {
            if (dadosVend[v].diario[d].semana === semLabel && diaNoMes(d, mes)) {
                return true;
            }
        }
    }
    return false;
}

// Formata "MM/YYYY" para nome legível: "Maio/2026"
function formatarMes(mesVal) {
    const [mm, yyyy] = mesVal.split('/');
    return `${NOMES_MESES[mm] || mm}/${yyyy}`;
}

// ===========================================================
// MOTOR GEOGRÁFICO & SOLUCIONADOR TSP (JAVASCRIPT)
// ===========================================================

// Calcula a distância de Haversine em km entre duas coordenadas
function haversineJS(lat1, lon1, lat2, lon2) {
    const R = 6371.0;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dphi = (lat2 - lat1) * Math.PI / 180;
    const dlon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dphi / 2) ** 2 +
              Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calcula a distância total de uma rota pelo array de índices
function obterDistanciaRota(coords, path) {
    let d = 0.0;
    for (let i = 0; i < path.length - 1; i++) {
        d += haversineJS(
            coords[path[i]].lat, coords[path[i]].lon,
            coords[path[i + 1]].lat, coords[path[i + 1]].lon
        );
    }
    return d;
}

// TSP: Vizinho Mais Próximo + Refinamento 2-opt (multi-start)
function resolverTSPJS(coords) {
    const n = coords.length;
    if (n <= 1) return { path: [0], distance: 0.0 };
    if (n === 2) {
        return { path: [0, 1], distance: haversineJS(coords[0].lat, coords[0].lon, coords[1].lat, coords[1].lon) };
    }

    let bestPath = null;
    let bestDist = Infinity;

    for (let start = 0; start < Math.min(5, n); start++) {
        // Construção: Vizinho Mais Próximo
        const unvisited = new Set(Array.from({ length: n }, (_, i) => i));
        let curr = start;
        unvisited.delete(curr);
        let path = [curr];

        while (unvisited.size > 0) {
            let nextNode = -1, minDist = Infinity;
            for (const node of unvisited) {
                const d = haversineJS(coords[curr].lat, coords[curr].lon, coords[node].lat, coords[node].lon);
                if (d < minDist) { minDist = d; nextNode = node; }
            }
            path.push(nextNode);
            unvisited.delete(nextNode);
            curr = nextNode;
        }

        // Refinamento 2-opt
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 1; i < n - 1; i++) {
                for (let j = i + 1; j < n; j++) {
                    const newPath = path.slice(0, i).concat(path.slice(i, j + 1).reverse()).concat(path.slice(j + 1));
                    if (obterDistanciaRota(coords, newPath) < obterDistanciaRota(coords, path)) {
                        path = newPath;
                        improved = true;
                    }
                }
            }
        }

        const dFinal = obterDistanciaRota(coords, path);
        if (dFinal < bestDist) { bestDist = dFinal; bestPath = path; }
    }

    return { path: bestPath, distance: bestDist };
}

// ===========================================================
// CONTROLE DE EXCLUSÕES DE VISITAS
// ===========================================================

function estaExcluida(vendedor, dia, cnpj) {
    const chave = `${vendedor}_${dia}`;
    return exclusoesVisitas[chave] && exclusoesVisitas[chave].has(cnpj);
}

function alternarExclusaoVisita(vendedor, dia, cnpj) {
    const chave = `${vendedor}_${dia}`;
    if (!exclusoesVisitas[chave]) exclusoesVisitas[chave] = new Set();
    if (exclusoesVisitas[chave].has(cnpj)) {
        exclusoesVisitas[chave].delete(cnpj);
    } else {
        exclusoesVisitas[chave].add(cnpj);
    }
    updateDashboard();
}
window.toggleExclusao = alternarExclusaoVisita;

// ===========================================================
// RECÁLCULO DINÂMICO DE ROTA
// ===========================================================

function recalcularRotaDia(vendedor, dia) {
    const dadosDiarios = DADOS_VENDEDORES.dados_por_vendedor[vendedor].diario[dia];
    if (!dadosDiarios || !dadosDiarios.rota) return { rotaAtiva: [], rotaExcluida: [], totalKm: 0.0 };

    const visitasAtivas   = [];
    const visitasExcluidas = [];

    dadosDiarios.rota.forEach(v => {
        const copia = JSON.parse(JSON.stringify(v));
        if (estaExcluida(vendedor, dia, v.cnpj)) {
            visitasExcluidas.push(copia);
        } else {
            visitasAtivas.push(copia);
        }
    });

    visitasExcluidas.forEach(v => { v.sequencia = null; v.km_trecho = 0.0; v.km_acumulado = 0.0; });

    if (visitasAtivas.length === 0) return { rotaAtiva: [], rotaExcluida: visitasExcluidas, totalKm: 0.0 };
    if (visitasAtivas.length === 1) {
        visitasAtivas[0].sequencia = 1; visitasAtivas[0].km_trecho = 0.0; visitasAtivas[0].km_acumulado = 0.0;
        return { rotaAtiva: visitasAtivas, rotaExcluida: visitasExcluidas, totalKm: 0.0 };
    }

    const coords = visitasAtivas.map(v => ({ lat: v.lat, lon: v.lon }));
    const { path, distance } = resolverTSPJS(coords);
    const rotaAtivaOrdenada = [];
    let acumulado = 0.0;

    path.forEach((nodeIdx, seqIdx) => {
        const visit = visitasAtivas[nodeIdx];
        let trecho = 0.0;
        if (seqIdx > 0) {
            const prev = rotaAtivaOrdenada[seqIdx - 1];
            trecho = haversineJS(prev.lat, prev.lon, visit.lat, visit.lon);
        }
        acumulado += trecho;
        visit.sequencia   = seqIdx + 1;
        visit.km_trecho   = Number(trecho.toFixed(2));
        visit.km_acumulado = Number(acumulado.toFixed(2));
        rotaAtivaOrdenada.push(visit);
    });

    return { rotaAtiva: rotaAtivaOrdenada, rotaExcluida: visitasExcluidas, totalKm: Number(distance.toFixed(2)) };
}

function obterMetricasDia(vendedor, dia) {
    const chave = `${vendedor}_${dia}`;
    if (!exclusoesVisitas[chave] || exclusoesVisitas[chave].size === 0) {
        const dd = DADOS_VENDEDORES.dados_por_vendedor[vendedor].diario[dia];
        return { km: dd.km, visitas: dd.visitas };
    }
    const res = recalcularRotaDia(vendedor, dia);
    return { km: res.totalKm, visitas: res.rotaAtiva.length };
}

// ===========================================================
// INICIALIZAÇÃO DA APLICAÇÃO
// ===========================================================

document.addEventListener('DOMContentLoaded', () => {
    if (typeof DADOS_VENDEDORES === 'undefined') {
        console.error('Dados dos vendedores não carregados!');
        return;
    }
    initMap();
    populateFilters();
    updateDashboard();

    // Listeners em cascata: Mês → Semana → Dia → Painel
    elVendedor.addEventListener('change', () => { updateWeekOptions(); updateDayOptions(); updateDashboard(); });
    elMes.addEventListener('change',      () => { updateWeekOptions(); updateDayOptions(); updateDashboard(); });
    elSemana.addEventListener('change',   () => { updateDayOptions(); updateDashboard(); });
    elDia.addEventListener('change',      () => { updateDashboard(); });
});

// ===========================================================
// MAPA LEAFLET
// ===========================================================

function initMap() {
    mapInstance = L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([-1.43, -48.47], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd', maxZoom: 20
    }).addTo(mapInstance);
    routeLineGroup = L.featureGroup().addTo(mapInstance);
    markersGroup   = L.featureGroup().addTo(mapInstance);
}

// ===========================================================
// PREENCHIMENTO DOS FILTROS
// ===========================================================

function populateFilters() {
    // Vendedores
    const vendedores = Object.keys(DADOS_VENDEDORES.dados_por_vendedor).sort();
    vendedores.forEach(vend => {
        const opt = document.createElement('option');
        opt.value = vend; opt.textContent = vend.toUpperCase();
        elVendedor.appendChild(opt);
    });

    // Meses — extraídos de todos os dias disponíveis, em ordem cronológica
    const mesesSet = new Set();
    DADOS_VENDEDORES.dias.forEach(d => mesesSet.add(obterMesDoDia(d)));
    const mesesOrdenados = Array.from(mesesSet).sort((a, b) => {
        const [ma, ya] = a.split('/'); const [mb, yb] = b.split('/');
        return new Date(ya, ma - 1) - new Date(yb, mb - 1);
    });
    mesesOrdenados.forEach(mes => {
        const opt = document.createElement('option');
        opt.value = mes; opt.textContent = formatarMes(mes);
        elMes.appendChild(opt);
    });

    updateWeekOptions();
    updateDayOptions();
}

// Atualiza o dropdown de Semana conforme Vendedor + Mês selecionados
function updateWeekOptions() {
    const vendSel = elVendedor.value;
    const mesSel  = elMes.value;
    const semAtual = elSemana.value; // preserva seleção atual se ainda válida

    elSemana.innerHTML = '<option value="todas">-- Todas as Semanas --</option>';

    const todasSemanas = DADOS_VENDEDORES.semanas;
    todasSemanas.forEach(sem => {
        // Filtra por mês (verifica se a semana tem pelo menos um dia no mês)
        if (!semanaNoMes(sem, mesSel)) return;

        // Filtra por vendedor (verifica se o vendedor tem pelo menos um dia nessa semana)
        if (vendSel !== 'todos') {
            const diario = DADOS_VENDEDORES.dados_por_vendedor[vendSel].diario;
            const temDia = Object.keys(diario).some(d => diario[d].semana === sem && diaNoMes(d, mesSel));
            if (!temDia) return;
        }

        const opt = document.createElement('option');
        opt.value = sem; opt.textContent = sem;
        if (sem === semAtual) opt.selected = true;
        elSemana.appendChild(opt);
    });
}

// Atualiza o dropdown de Dia conforme Vendedor + Mês + Semana
function updateDayOptions() {
    const vendSel = elVendedor.value;
    const mesSel  = elMes.value;
    const semSel  = elSemana.value;

    elDia.innerHTML = '';

    if (vendSel === 'todos') {
        elDia.innerHTML = '<option value="todos">-- Selecione um Vendedor --</option>';
        elDia.disabled = true;
        return;
    }

    elDia.disabled = false;
    elDia.innerHTML = '<option value="todos">-- Todos os Dias --</option>';

    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor[vendSel];
    const dias = Object.keys(dadosVend.diario);

    dias.sort((a, b) => {
        const p = s => { const [d, m, y] = s.split('/'); return new Date(y, m - 1, d); };
        return p(a) - p(b);
    });

    dias.forEach(dia => {
        const diaDados = dadosVend.diario[dia];
        // Aplica filtro de mês e semana
        if (!diaNoMes(dia, mesSel)) return;
        if (semSel !== 'todas' && diaDados.semana !== semSel) return;

        const opt = document.createElement('option');
        opt.value = dia;
        opt.textContent = `${dia}  (${diaDados.semana.split(' ')[1] || ''})`;
        elDia.appendChild(opt);
    });
}

// ===========================================================
// ATUALIZAÇÃO GERAL DO PAINEL
// ===========================================================

function updateDashboard() {
    const vendSel = elVendedor.value;
    const mesSel  = elMes.value;
    const semSel  = elSemana.value;
    const diaSel  = elDia.value;

    // --- KPIs ---
    const metricas = calcularMetricasFiltradas(vendSel, mesSel, semSel, diaSel);
    elKpiTotalKm.textContent      = `${metricas.totalKm.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    elKpiTotalVisitas.textContent = metricas.totalVisitas;
    elKpiMediaDia.textContent     = `${metricas.mediaKmDia.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    elKpiMediaVisita.textContent  = `${metricas.mediaKmVisita.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;

    // --- Badge do mapa ---
    let mapText = 'Visão Geral';
    const partes = [];
    if (vendSel !== 'todos')  partes.push(vendSel.toUpperCase());
    if (mesSel  !== 'todos')  partes.push(formatarMes(mesSel));
    if (semSel  !== 'todas')  partes.push(semSel);
    if (diaSel  !== 'todos' && diaSel !== '') partes.push(diaSel);
    if (partes.length > 0) mapText = partes.join(' | ');
    elMapBadge.textContent = mapText;

    // --- Mapa, Gráficos e Tabela ---
    desenharMapa(vendSel, mesSel, semSel, diaSel);
    atualizarGrafico(vendSel, mesSel, semSel, diaSel);
    atualizarTabelaDetalhes(vendSel, diaSel);
}

// ===========================================================
// CÁLCULO DE MÉTRICAS (com filtro de mês)
// ===========================================================

function calcularMetricasFiltradas(vend, mes, sem, dia) {
    let totalKm = 0.0, totalVisitas = 0, diasAtivos = 0;
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor;

    const processar = (v, d) => {
        const dd = dadosVend[v].diario[d];
        if (!diaNoMes(d, mes)) return;
        if (sem !== 'todas' && dd.semana !== sem) return;
        const st = obterMetricasDia(v, d);
        totalKm += st.km;
        totalVisitas += st.visitas;
        if (st.visitas > 0) diasAtivos++;
    };

    if (vend === 'todos') {
        Object.keys(dadosVend).forEach(v => Object.keys(dadosVend[v].diario).forEach(d => processar(v, d)));
    } else if (dia !== 'todos' && dia !== '') {
        if (dadosVend[vend].diario[dia]) {
            const st = obterMetricasDia(vend, dia);
            totalKm = st.km; totalVisitas = st.visitas; diasAtivos = st.visitas > 0 ? 1 : 0;
        }
    } else {
        Object.keys(dadosVend[vend].diario).forEach(d => processar(vend, d));
    }

    return {
        totalKm,
        totalVisitas,
        mediaKmDia:    diasAtivos  > 0 ? totalKm / diasAtivos  : 0.0,
        mediaKmVisita: totalVisitas > 0 ? totalKm / totalVisitas : 0.0
    };
}

// ===========================================================
// MAPA — ROTAS E MARCADORES
// ===========================================================

function desenharMapa(vend, mes, sem, dia) {
    routeLineGroup.clearLayers();
    markersGroup.clearLayers();
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor;
    let bounds = [];

    if (vend !== 'todos' && dia !== 'todos' && dia !== '') {
        // Rota detalhada de um dia específico
        const res = recalcularRotaDia(vend, dia);
        const cor = CORES_VENDEDORES[vend] || CORES_VENDEDORES['padrao'];
        const latLonsAtivas = [];

        res.rotaAtiva.forEach(visit => {
            const ll = [visit.lat, visit.lon];
            latLonsAtivas.push(ll); bounds.push(ll);
            const icon = L.divIcon({
                className: 'custom-marker',
                html: `<div class="marker-pin" style="background:${cor.hex};box-shadow:0 0 10px ${cor.hex}80"></div><span class="marker-number">${visit.sequencia}</span>`,
                iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28]
            });
            const popup = `
                <div class="popup-content">
                    <div class="popup-title">${visit.cliente}</div>
                    <div class="popup-row"><strong>Seq:</strong> ${visit.sequencia} de ${res.rotaAtiva.length}</div>
                    <div class="popup-row"><strong>CNPJ:</strong> ${visit.cnpj}</div>
                    <div class="popup-row"><strong>Tipo:</strong> ${visit.tipo}</div>
                    <div class="popup-row"><strong>Km do Trecho:</strong> ${visit.km_trecho} km</div>
                    <div class="popup-row"><strong>Km Acumulado:</strong> ${visit.km_acumulado} km</div>
                    <button class="popup-btn-excluir" onclick="toggleExclusao('${vend}','${dia}','${visit.cnpj}')">
                        <i class="fa-solid fa-trash-can"></i> Excluir da Rota
                    </button>
                </div>`;
            L.marker(ll, { icon }).bindPopup(popup).addTo(markersGroup);
        });

        res.rotaExcluida.forEach(visit => {
            const ll = [visit.lat, visit.lon]; bounds.push(ll);
            const icon = L.divIcon({
                className: 'custom-marker excluido',
                html: `<div class="marker-pin"></div><span class="marker-number"><i class="fa-solid fa-xmark"></i></span>`,
                iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24]
            });
            const popup = `
                <div class="popup-content">
                    <div class="popup-title" style="color:#64748b;text-decoration:line-through">${visit.cliente}</div>
                    <div class="popup-row" style="color:#ef4444;font-weight:700">VISITA EXCLUÍDA DA ROTA</div>
                    <div class="popup-row"><strong>CNPJ:</strong> ${visit.cnpj}</div>
                    <div class="popup-row"><strong>Tipo:</strong> ${visit.tipo}</div>
                    <button class="popup-btn-restaurar" onclick="toggleExclusao('${vend}','${dia}','${visit.cnpj}')">
                        <i class="fa-solid fa-rotate-left"></i> Restaurar na Rota
                    </button>
                </div>`;
            L.marker(ll, { icon }).bindPopup(popup).addTo(markersGroup);
        });

        if (latLonsAtivas.length > 1) {
            L.polyline(latLonsAtivas, { color: cor.hex, weight: 10, opacity: 0.2, lineJoin: 'round' }).addTo(routeLineGroup);
            L.polyline(latLonsAtivas, { color: cor.hex, weight: 4, opacity: 0.85, dashArray: '2,6', lineJoin: 'round' }).addTo(routeLineGroup);
        }

    } else {
        // Visão agregada: pinos simples filtrados por vendedor + mês + semana
        const addMarcador = (lat, lon, vName, cName, cCnpj, cTipo, dateStr) => {
            const ll = [lat, lon]; bounds.push(ll);
            const cor = CORES_VENDEDORES[vName] || CORES_VENDEDORES['padrao'];
            const icon = L.divIcon({
                className: 'custom-marker',
                html: `<div class="marker-pin" style="background:${cor.hex};box-shadow:0 0 10px ${cor.glow}"></div><span class="marker-number"><i class="fa-solid fa-user-tie" style="font-size:8px"></i></span>`,
                iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -22]
            });
            const popup = `
                <div class="popup-content">
                    <div class="popup-title">${cName}</div>
                    <div class="popup-row"><strong>Vendedor:</strong> ${vName.toUpperCase()}</div>
                    <div class="popup-row"><strong>Data:</strong> ${dateStr}</div>
                    <div class="popup-row"><strong>CNPJ:</strong> ${cCnpj}</div>
                    <div class="popup-row"><strong>Tipo:</strong> ${cTipo}</div>
                </div>`;
            L.marker(ll, { icon }).bindPopup(popup).addTo(markersGroup);
        };

        const vendedores = vend === 'todos' ? Object.keys(dadosVend) : [vend];
        vendedores.forEach(v => {
            Object.keys(dadosVend[v].diario).forEach(d => {
                const dd = dadosVend[v].diario[d];
                if (!diaNoMes(d, mes)) return;
                if (sem !== 'todas' && dd.semana !== sem) return;
                dd.rota.forEach(visit => {
                    if (!estaExcluida(v, d, visit.cnpj)) {
                        addMarcador(visit.lat, visit.lon, v, visit.cliente, visit.cnpj, visit.tipo, d);
                    }
                });
            });
        });
    }

    if (bounds.length > 0) {
        mapInstance.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] });
    } else {
        mapInstance.setView([-1.43, -48.47], 12);
    }
}

// ===========================================================
// TABELA DE DETALHES DA ROTA
// ===========================================================

function atualizarTabelaDetalhes(vend, dia) {
    elRouteTableBody.innerHTML = '';

    if (vend === 'todos' || dia === 'todos' || dia === '') {
        elRouteDetailsBadge.textContent = 'Nenhum dia selecionado';
        elRouteTableBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
            <i class="fa-solid fa-circle-info"></i>
            <p>Selecione um <strong>Vendedor</strong> e um <strong>Dia específico</strong> nos filtros acima para visualizar a sequência ordenada do trajeto.</p>
        </div></td></tr>`;
        return;
    }

    const res = recalcularRotaDia(vend, dia);
    const totalOrig = DADOS_VENDEDORES.dados_por_vendedor[vend].diario[dia].visitas;

    if (res.rotaAtiva.length === 0 && res.rotaExcluida.length === 0) {
        elRouteDetailsBadge.textContent = 'Nenhum dado de rota';
        elRouteTableBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
            <i class="fa-solid fa-triangle-exclamation"></i><p>Nenhuma visita registrada para este dia.</p>
        </div></td></tr>`;
        return;
    }

    elRouteDetailsBadge.textContent = `${vend.toUpperCase()} | ${dia}  (${res.rotaAtiva.length} de ${totalOrig} Visitas Ativas — ${res.totalKm} km)`;

    // Visitas ativas
    res.rotaAtiva.forEach(visit => {
        const tr = document.createElement('tr');
        let seqClass = visit.sequencia === 1 ? 'first' : (visit.sequencia === res.rotaAtiva.length ? 'last' : '');
        const tipo = visit.tipo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.innerHTML = `
            <td><span class="seq-badge ${seqClass}">${visit.sequencia}</span></td>
            <td><strong>${visit.cliente}</strong></td>
            <td style="font-family:monospace;color:var(--text-secondary)">${visit.cnpj}</td>
            <td><span class="tipo-badge ${tipo}">${visit.tipo}</span></td>
            <td style="font-size:11px;color:var(--text-muted);font-family:monospace">${visit.lat.toFixed(5)}, ${visit.lon.toFixed(5)}</td>
            <td style="text-align:right;font-weight:600;color:var(--accent-cyan)">${visit.km_trecho.toFixed(2)} km</td>
            <td style="text-align:right;font-weight:700;color:var(--text-primary)">${visit.km_acumulado.toFixed(2)} km</td>
            <td style="text-align:center">
                <button class="btn-action btn-excluir" title="Excluir visita temporariamente da rota"
                    onclick="toggleExclusao('${vend}','${dia}','${visit.cnpj}')">
                    <i class="fa-solid fa-trash-can"></i> Excluir
                </button>
            </td>`;
        elRouteTableBody.appendChild(tr);
    });

    // Visitas excluídas (riscadas, no final)
    res.rotaExcluida.forEach(visit => {
        const tr = document.createElement('tr');
        tr.className = 'row-excluida';
        const tipo = visit.tipo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.innerHTML = `
            <td><span class="seq-badge" style="background:transparent;color:var(--text-muted);border-style:dashed"><i class="fa-solid fa-xmark"></i></span></td>
            <td><strong>${visit.cliente}</strong></td>
            <td style="font-family:monospace;color:var(--text-muted)">${visit.cnpj}</td>
            <td><span class="tipo-badge ${tipo}" style="opacity:0.6;filter:grayscale(1)">${visit.tipo}</span></td>
            <td style="font-size:11px;color:var(--text-muted);font-family:monospace">${visit.lat.toFixed(5)}, ${visit.lon.toFixed(5)}</td>
            <td style="text-align:right;color:var(--text-muted)">-</td>
            <td style="text-align:right;color:var(--text-muted)">-</td>
            <td style="text-align:center">
                <button class="btn-action btn-restaurar" title="Adicionar visita de volta à rota"
                    onclick="toggleExclusao('${vend}','${dia}','${visit.cnpj}')">
                    <i class="fa-solid fa-rotate-left"></i> Restaurar
                </button>
            </td>`;
        elRouteTableBody.appendChild(tr);
    });
}

// ===========================================================
// ABAS DE GRÁFICOS
// ===========================================================

function switchTab(tabName) {
    document.querySelectorAll('.stats-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(tabName.substring(0, 5))) btn.classList.add('active');
    });
    activeTab = tabName;
    updateDashboard();
}

// ===========================================================
// GRÁFICOS (com filtro de mês)
// ===========================================================

function atualizarGrafico(vend, mes, sem, dia) {
    if (chartInstance) chartInstance.destroy();

    const ctx = document.getElementById('stats-chart').getContext('2d');
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor;

    const defaultOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: '#f8fafc', font: { family: 'Inter', size: 11 } } },
            tooltip: { backgroundColor: '#1e293b', titleColor: '#f8fafc', bodyColor: '#cbd5e1', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1 }
        },
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Inter' } } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Inter' } } }
        }
    };

    // Helper: verifica se um dia passa pelos filtros ativos
    const diaAtivo = (d, semanaStr) => {
        if (!diaNoMes(d, mes)) return false;
        if (sem !== 'todas' && semanaStr !== sem) return false;
        return true;
    };

    let type = 'bar', data = { labels: [], datasets: [] };
    const opts = JSON.parse(JSON.stringify(defaultOptions));

    if (activeTab === 'vendedores') {
        opts.indexAxis = 'y';
        const labels = [], kmValues = [], colors = [];

        Object.keys(DADOS_VENDEDORES.vendedores).forEach(v => {
            let km = 0.0;
            Object.keys(dadosVend[v].diario).forEach(d => {
                if (diaAtivo(d, dadosVend[v].diario[d].semana)) km += obterMetricasDia(v, d).km;
            });
            labels.push(v.toUpperCase());
            kmValues.push(Number(km.toFixed(2)));
            colors.push(CORES_VENDEDORES[v]?.hex || CORES_VENDEDORES['padrao'].hex);
        });

        data = { labels, datasets: [{ label: 'Km Percorridos', data: kmValues, backgroundColor: colors, borderRadius: 6, borderWidth: 0 }] };
        opts.scales.x.title = { display: true, text: 'Quilômetros (km)', color: '#94a3b8' };

    } else if (activeTab === 'semanal') {
        // Filtra semanas pelo mês selecionado
        const semanasVisiveis = DADOS_VENDEDORES.semanas.filter(s => semanaNoMes(s, mes));
        data.labels = semanasVisiveis.map(s => s.split(' ')[1] || s);

        const calcKmSemana = (v, s) => {
            let km = 0.0;
            Object.keys(dadosVend[v].diario).forEach(d => {
                const dd = dadosVend[v].diario[d];
                if (dd.semana === s && diaNoMes(d, mes)) km += obterMetricasDia(v, d).km;
            });
            return Number(km.toFixed(2));
        };

        const vendedores = vend === 'todos' ? Object.keys(dadosVend) : [vend];
        data.datasets = vendedores.map(v => ({
            label: v.toUpperCase(),
            data: semanasVisiveis.map(s => calcKmSemana(v, s)),
            backgroundColor: CORES_VENDEDORES[v]?.hex || CORES_VENDEDORES['padrao'].hex,
            borderRadius: 4
        }));
        opts.scales.y.title = { display: true, text: 'Km Percorridos', color: '#94a3b8' };

    } else if (activeTab === 'diario') {
        type = 'line';
        // Filtra dias pelos filtros ativos
        const diasVisiveis = DADOS_VENDEDORES.dias.filter(d => {
            if (!diaNoMes(d, mes)) return false;
            if (sem === 'todas') return true;
            // verifica se pelo menos um vendedor tem esse dia na semana correta
            return Object.keys(dadosVend).some(v => dadosVend[v].diario[d]?.semana === sem);
        });
        data.labels = diasVisiveis;

        const vendedores = vend === 'todos' ? Object.keys(dadosVend) : [vend];
        data.datasets = vendedores.map(v => {
            const cor = CORES_VENDEDORES[v]?.hex || CORES_VENDEDORES['padrao'].hex;
            const kmDia = diasVisiveis.map(d => dadosVend[v].diario[d] ? obterMetricasDia(v, d).km : 0);
            return {
                label: v.toUpperCase(),
                data: kmDia,
                borderColor: cor,
                backgroundColor: vend === 'todos' ? 'transparent' : cor + '1a',
                fill: vend !== 'todos',
                borderWidth: vend === 'todos' ? 2 : 3,
                tension: 0.3,
                pointRadius: vend === 'todos' ? 3 : 4,
                pointBackgroundColor: cor
            };
        });
        opts.scales.y.title = { display: true, text: 'Quilômetros (km)', color: '#94a3b8' };
    }

    chartInstance = new Chart(ctx, { type, data, options: opts });
}
