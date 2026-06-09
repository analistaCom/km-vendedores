// Variáveis Globais de Controle
let mapInstance = null;
let routeLineGroup = null;
let markersGroup = null;
let chartInstance = null;
let activeTab = 'vendedores'; // 'vendedores' | 'semanal' | 'diario'

// Elementos do DOM
const elVendedor = document.getElementById('filter-vendedor');
const elSemana = document.getElementById('filter-semana');
const elDia = document.getElementById('filter-dia');

const elKpiTotalKm = document.getElementById('kpi-total-km');
const elKpiTotalVisitas = document.getElementById('kpi-total-visitas');
const elKpiMediaDia = document.getElementById('kpi-media-dia');
const elKpiMediaVisita = document.getElementById('kpi-media-visita');

const elMapBadge = document.getElementById('map-badge');
const elRouteDetailsBadge = document.getElementById('route-details-badge');
const elRouteTableBody = document.getElementById('route-table-body');

// Cores dos Vendedores
const CORES_VENDEDORES = {
    'aurea': { hex: '#06b6d4', glow: 'rgba(6, 182, 212, 0.4)' },
    'marceloa': { hex: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)' },
    'roxanne': { hex: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.4)' },
    'padrao': { hex: '#10b981', glow: 'rgba(16, 185, 129, 0.4)' }
};

// Inicialização da Aplicação
document.addEventListener('DOMContentLoaded', () => {
    if (typeof DADOS_VENDEDORES === 'undefined') {
        console.error("Dados dos vendedores não carregados!");
        return;
    }
    
    initMap();
    populateFilters();
    updateDashboard();
    
    // Listeners de Eventos
    elVendedor.addEventListener('change', () => {
        updateDayOptions();
        updateDashboard();
    });
    
    elSemana.addEventListener('change', () => {
        updateDayOptions();
        updateDashboard();
    });
    
    elDia.addEventListener('change', () => {
        updateDashboard();
    });
});

// Inicializa o Mapa Leaflet
function initMap() {
    // Belém/PA como coordenada central padrão
    mapInstance = L.map('map', {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView([-1.43, -48.47], 12);
    
    // Adiciona o Tile Layer CartoDB Dark Matter para o tema escuro
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(mapInstance);
    
    routeLineGroup = L.featureGroup().addTo(mapInstance);
    markersGroup = L.featureGroup().addTo(mapInstance);
}

// Preenche os Filtros Iniciais
function populateFilters() {
    // Vendedores
    const vendedores = Object.keys(DADOS_VENDEDORES.dados_por_vendedor);
    vendedores.sort();
    vendedores.forEach(vend => {
        const option = document.createElement('option');
        option.value = vend;
        option.textContent = vend.toUpperCase();
        elVendedor.appendChild(option);
    });
    
    // Semanas
    const semanas = DADOS_VENDEDORES.semanas;
    semanas.forEach(sem => {
        const option = document.createElement('option');
        option.value = sem;
        option.textContent = sem;
        elSemana.appendChild(option);
    });
    
    updateDayOptions();
}

// Atualiza as opções do dropdown de dias com base no vendedor e semana selecionados
function updateDayOptions() {
    const vendSel = elVendedor.value;
    const semSel = elSemana.value;
    
    // Limpa dropdown de dias
    elDia.innerHTML = '';
    
    if (vendSel === 'todos') {
        const option = document.createElement('option');
        option.value = 'todos';
        option.textContent = '-- Selecione um Vendedor --';
        elDia.appendChild(option);
        elDia.disabled = true;
        return;
    }
    
    elDia.disabled = false;
    
    // Adiciona a opção padrão de todos os dias
    const optTodos = document.createElement('option');
    optTodos.value = 'todos';
    optTodos.textContent = '-- Todos os Dias --';
    elDia.appendChild(optTodos);
    
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor[vendSel];
    const dias = Object.keys(dadosVend.diario);
    
    // Ordena os dias cronologicamente
    dias.sort((a, b) => {
        const parseDate = str => {
            const parts = str.split('/');
            return new Date(parts[2], parts[1] - 1, parts[0]);
        };
        return parseDate(a) - parseDate(b);
    });
    
    dias.forEach(dia => {
        const diaDados = dadosVend.diario[dia];
        // Se houver filtro de semana, apenas adiciona dias daquela semana
        if (semSel === 'todas' || diaDados.semana === semSel) {
            const option = document.createElement('option');
            option.value = dia;
            option.textContent = `${dia} (${diaDados.semana.split(' ')[1] || ''})`;
            elDia.appendChild(option);
        }
    });
}

// Atualiza todo o painel (KPIs, Mapa, Gráficos, Tabela)
function updateDashboard() {
    const vendSel = elVendedor.value;
    const semSel = elSemana.value;
    const diaSel = elDia.value;
    
    // 1. Calcula e atualiza as métricas KPIs
    const metricas = calcularMetricasFiltradas(vendSel, semSel, diaSel);
    elKpiTotalKm.textContent = `${metricas.totalKm.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    elKpiTotalVisitas.textContent = metricas.totalVisitas;
    elKpiMediaDia.textContent = `${metricas.mediaKmDia.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    elKpiMediaVisita.textContent = `${metricas.mediaKmVisita.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    
    // 2. Atualiza os crachás/títulos das seções
    let mapText = "Visão Geral";
    if (vendSel !== 'todos') {
        mapText = vendSel.toUpperCase();
        if (semSel !== 'todas') mapText += ` | ${semSel}`;
        if (diaSel !== 'todos') mapText += ` | ${diaSel}`;
    } else {
        if (semSel !== 'todas') mapText = `Visão Geral | ${semSel}`;
    }
    elMapBadge.textContent = mapText;
    
    // 3. Atualiza o Mapa (Rotas e Marcadores)
    desenharMapa(vendSel, semSel, diaSel);
    
    // 4. Atualiza o Gráfico de Estatísticas
    atualizarGrafico(vendSel, semSel, diaSel);
    
    // 5. Atualiza a Tabela de Detalhes
    atualizarTabelaDetalhes(vendSel, diaSel);
}

// Faz o cálculo dinâmico das métricas baseando-se nos filtros
function calcularMetricasFiltradas(vend, sem, dia) {
    let totalKm = 0.0;
    let totalVisitas = 0;
    let diasAtivos = 0;
    
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor;
    
    if (vend === 'todos') {
        // Todos os vendedores
        Object.keys(dadosVend).forEach(v => {
            const vDiario = dadosVend[v].diario;
            Object.keys(vDiario).forEach(d => {
                const diaDados = vDiario[d];
                if (sem === 'todas' || diaDados.semana === sem) {
                    totalKm += diaDados.km;
                    totalVisitas += diaDados.visitas;
                    diasAtivos++;
                }
            });
        });
    } else {
        // Vendedor específico
        const vDiario = dadosVend[vend].diario;
        if (dia !== 'todos' && dia !== '') {
            // Dia específico
            if (vDiario[dia]) {
                totalKm = vDiario[dia].km;
                totalVisitas = vDiario[dia].visitas;
                diasAtivos = 1;
            }
        } else {
            // Todos os dias do vendedor (filtrados ou não por semana)
            Object.keys(vDiario).forEach(d => {
                const diaDados = vDiario[d];
                if (sem === 'todas' || diaDados.semana === sem) {
                    totalKm += diaDados.km;
                    totalVisitas += diaDados.visitas;
                    diasAtivos++;
                }
            });
        }
    }
    
    return {
        totalKm,
        totalVisitas,
        mediaKmDia: diasAtivos > 0 ? totalKm / diasAtivos : 0.0,
        mediaKmVisita: totalVisitas > 0 ? totalKm / totalVisitas : 0.0
    };
}

// Limpa e desenha os caminhos e pinos no mapa Leaflet
function desenharMapa(vend, sem, dia) {
    routeLineGroup.clearLayers();
    markersGroup.clearLayers();
    
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor;
    let bounds = [];
    
    if (vend !== 'todos' && dia !== 'todos' && dia !== '') {
        // 1. Rota de um dia específico (Caminho ordenado por TSP com linhas conectando)
        const rotaDia = dadosVend[vend].diario[dia];
        if (rotaDia && rotaDia.rota) {
            const corInfo = CORES_VENDEDORES[vend] || CORES_VENDEDORES['padrao'];
            const latLons = [];
            
            rotaDia.rota.forEach(visit => {
                const latLon = [visit.lat, visit.lon];
                latLons.push(latLon);
                bounds.push(latLon);
                
                // Marcador personalizado numerado
                const markerIcon = L.divIcon({
                    className: 'custom-marker',
                    html: `<div class="marker-pin" style="background: ${corInfo.hex}; box-shadow: 0 0 10px ${corInfo.hex}80;"></div><span class="marker-number">${visit.sequencia}</span>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 30],
                    popupAnchor: [0, -28]
                });
                
                const popupContent = `
                    <div class="popup-content">
                        <div class="popup-title">${visit.cliente}</div>
                        <div class="popup-row"><strong>Seq:</strong> ${visit.sequencia} de ${rotaDia.rota.length}</div>
                        <div class="popup-row"><strong>CNPJ:</strong> ${visit.cnpj}</div>
                        <div class="popup-row"><strong>Tipo:</strong> ${visit.tipo}</div>
                        <div class="popup-row"><strong>Km do Trecho:</strong> ${visit.km_trecho} km</div>
                        <div class="popup-row"><strong>Km Acumulado:</strong> ${visit.km_acumulado} km</div>
                    </div>
                `;
                
                L.marker(latLon, { icon: markerIcon })
                    .bindPopup(popupContent)
                    .addTo(markersGroup);
            });
            
            // Desenha a linha da rota
            if (latLons.length > 1) {
                L.polyline(latLons, {
                    color: corInfo.hex,
                    weight: 4,
                    opacity: 0.85,
                    dashArray: '2, 6', // Efeito tracejado moderno
                    lineJoin: 'round'
                }).addTo(routeLineGroup);
                
                // Adiciona uma linha de brilho por baixo
                L.polyline(latLons, {
                    color: corInfo.hex,
                    weight: 10,
                    opacity: 0.2,
                    lineJoin: 'round'
                }).addTo(routeLineGroup);
            }
        }
    } else {
        // 2. Múltiplos dias ou múltiplos vendedores (Apenas marcadores espalhados, sem linhas)
        const adicionarMarcadorSimples = (lat, lon, vName, cName, cCnpj, cTipo, dateStr) => {
            const latLon = [lat, lon];
            bounds.push(latLon);
            
            const corInfo = CORES_VENDEDORES[vName] || CORES_VENDEDORES['padrao'];
            const markerIcon = L.divIcon({
                className: 'custom-marker',
                html: `<div class="marker-pin" style="background: ${corInfo.hex}; box-shadow: 0 0 10px ${corInfo.glow};"></div><span class="marker-number"><i class="fa-solid fa-user-tie" style="font-size: 8px;"></i></span>`,
                iconSize: [24, 24],
                iconAnchor: [12, 24],
                popupAnchor: [0, -22]
            });
            
            const popupContent = `
                <div class="popup-content">
                    <div class="popup-title">${cName}</div>
                    <div class="popup-row"><strong>Vendedor:</strong> ${vName.toUpperCase()}</div>
                    <div class="popup-row"><strong>Data:</strong> ${dateStr}</div>
                    <div class="popup-row"><strong>CNPJ:</strong> ${cCnpj}</div>
                    <div class="popup-row"><strong>Tipo:</strong> ${cTipo}</div>
                </div>
            `;
            
            L.marker(latLon, { icon: markerIcon })
                .bindPopup(popupContent)
                .addTo(markersGroup);
        };
        
        if (vend !== 'todos') {
            // Todos os dias de um vendedor específico (com ou sem filtro de semana)
            const vDiario = dadosVend[vend].diario;
            Object.keys(vDiario).forEach(d => {
                const diaDados = vDiario[d];
                if (sem === 'todas' || diaDados.semana === sem) {
                    diaDados.rota.forEach(visit => {
                        adicionarMarcadorSimples(visit.lat, visit.lon, vend, visit.cliente, visit.cnpj, visit.tipo, d);
                    });
                }
            });
        } else {
            // Todos os vendedores
            Object.keys(dadosVend).forEach(v => {
                const vDiario = dadosVend[v].diario;
                Object.keys(vDiario).forEach(d => {
                    const diaDados = vDiario[d];
                    if (sem === 'todas' || diaDados.semana === sem) {
                        diaDados.rota.forEach(visit => {
                            adicionarMarcadorSimples(visit.lat, visit.lon, v, visit.cliente, visit.cnpj, visit.tipo, d);
                        });
                    }
                });
            });
        }
    }
    
    // Centraliza o mapa com base nos limites dos marcadores plotados
    if (bounds.length > 0) {
        mapInstance.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] });
    } else {
        // Reseta para Belém caso não tenha dados
        mapInstance.setView([-1.43, -48.47], 12);
    }
}

// Atualiza a tabela de detalhes da rota ordenada
function atualizarTabelaDetalhes(vend, dia) {
    elRouteTableBody.innerHTML = '';
    
    if (vend === 'todos' || dia === 'todos' || dia === '') {
        elRouteDetailsBadge.textContent = "Nenhum dia selecionado";
        elRouteTableBody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fa-solid fa-circle-info"></i>
                        <p>Selecione um <strong>Vendedor</strong> e um <strong>Dia específico</strong> nos filtros acima para visualizar a sequência ordenada do trajeto.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor[vend];
    const rotaDia = dadosVend.diario[dia];
    
    if (!rotaDia || !rotaDia.rota || rotaDia.rota.length === 0) {
        elRouteDetailsBadge.textContent = "Nenhum dado de rota";
        elRouteTableBody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <p>Nenhuma visita registrada para este dia.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    elRouteDetailsBadge.textContent = `${vend.toUpperCase()} | ${dia} (${rotaDia.rota.length} Visitas, ${rotaDia.km} km)`;
    
    rotaDia.rota.forEach(visit => {
        const tr = document.createElement('tr');
        
        let seqClass = '';
        if (visit.sequencia === 1) seqClass = 'first';
        else if (visit.sequencia === rotaDia.rota.length) seqClass = 'last';
        
        const tipoClass = visit.tipo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        tr.innerHTML = `
            <td><span class="seq-badge ${seqClass}">${visit.sequencia}</span></td>
            <td><strong>${visit.cliente}</strong></td>
            <td style="font-family: monospace; color: var(--text-secondary);">${visit.cnpj}</td>
            <td><span class="tipo-badge ${tipoClass}">${visit.tipo}</span></td>
            <td style="font-size: 11px; color: var(--text-muted); font-family: monospace;">${visit.lat.toFixed(5)}, ${visit.lon.toFixed(5)}</td>
            <td style="text-align: right; font-weight: 600; color: var(--accent-cyan);">${visit.km_trecho.toFixed(2)} km</td>
            <td style="text-align: right; font-weight: 700; color: var(--text-primary);">${visit.km_acumulado.toFixed(2)} km</td>
        `;
        
        elRouteTableBody.appendChild(tr);
    });
}

// Altera a aba de gráficos
function switchTab(tabName) {
    document.querySelectorAll('.stats-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(tabName.substring(0, 5))) {
            btn.classList.add('active');
        }
    });
    activeTab = tabName;
    updateDashboard();
}

// Constrói ou atualiza o gráfico da aba ativa com base nos filtros
function atualizarGrafico(vend, sem, dia) {
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    const ctx = document.getElementById('stats-chart').getContext('2d');
    const dadosVend = DADOS_VENDEDORES.dados_por_vendedor;
    
    let chartType = 'bar';
    let chartData = { labels: [], datasets: [] };
    let chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: { color: '#f8fafc', font: { family: 'Inter', size: 11 } }
            },
            tooltip: {
                backgroundColor: '#1e293b',
                titleColor: '#f8fafc',
                bodyColor: '#cbd5e1',
                borderColor: 'rgba(255, 255, 255, 0.08)',
                borderWidth: 1
            }
        },
        scales: {
            x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Inter' } } },
            y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Inter' } } }
        }
    };
    
    if (activeTab === 'vendedores') {
        // ABA 1: Comparativo de Vendedores (Quilômetros Totais Acumulados no período filtrado)
        chartType = 'bar';
        chartOptions.indexAxis = 'y'; // Barra horizontal
        
        const labels = [];
        const kmValues = [];
        const visitasValues = [];
        const backgroundColors = [];
        
        Object.keys(DADOS_VENDEDORES.vendedores).forEach(v => {
            labels.push(v.toUpperCase());
            
            // Calcula distância sob filtro de semana
            let vKm = 0.0;
            let vVisitas = 0;
            const diario = dadosVend[v].diario;
            Object.keys(diario).forEach(d => {
                const diaDados = diario[d];
                if (sem === 'todas' || diaDados.semana === sem) {
                    vKm += diaDados.km;
                    vVisitas += diaDados.visitas;
                }
            });
            
            kmValues.push(Number(vKm.toFixed(2)));
            visitasValues.push(vVisitas);
            backgroundColors.push(CORES_VENDEDORES[v]?.hex || CORES_VENDEDORES['padrao'].hex);
        });
        
        chartData = {
            labels: labels,
            datasets: [
                {
                    label: 'Km Percorridos',
                    data: kmValues,
                    backgroundColor: backgroundColors,
                    borderRadius: 6,
                    borderWidth: 0
                }
            ]
        };
        
        chartOptions.scales.x.title = { display: true, text: 'Quilômetros (km)', color: '#94a3b8' };
        
    } else if (activeTab === 'semanal') {
        // ABA 2: Análise Semanal (Total de km por semana para os filtros correntes)
        chartType = 'bar';
        const semanas = DADOS_VENDEDORES.semanas;
        chartData.labels = semanas.map(s => s.split(' ')[1] || s); // Apenas "19", "20", etc. ou a string da semana
        
        if (vend === 'todos') {
            // Mostra o empilhado/comparativo de todos os vendedores
            const datasets = [];
            Object.keys(dadosVend).forEach(v => {
                const vSemanaKm = semanas.map(s => {
                    let k = 0.0;
                    const vSemanaDados = dadosVend[v].semanal[s];
                    if (vSemanaDados) k = vSemanaDados.km;
                    return Number(k.toFixed(2));
                });
                
                datasets.push({
                    label: v.toUpperCase(),
                    data: vSemanaKm,
                    backgroundColor: CORES_VENDEDORES[v]?.hex || CORES_VENDEDORES['padrao'].hex,
                    borderRadius: 4
                });
            });
            chartData.datasets = datasets;
            chartOptions.scales.y.stacked = false;
        } else {
            // Apenas para o vendedor selecionado
            const vSemanaKm = semanas.map(s => {
                let k = 0.0;
                const vSemanaDados = dadosVend[vend].semanal[s];
                if (vSemanaDados) k = vSemanaDados.km;
                return Number(k.toFixed(2));
            });
            
            chartData.datasets = [
                {
                    label: `Km de ${vend.toUpperCase()}`,
                    data: vSemanaKm,
                    backgroundColor: CORES_VENDEDORES[vend]?.hex || CORES_VENDEDORES['padrao'].hex,
                    borderRadius: 6
                }
            ];
        }
        
        chartOptions.scales.y.title = { display: true, text: 'Km Percorridos', color: '#94a3b8' };
        
    } else if (activeTab === 'diario') {
        // ABA 3: Evolução Diária (Linha temporal de Km)
        chartType = 'line';
        const dias = DADOS_VENDEDORES.dias;
        
        // Filtra dias se houver filtro de semana
        const diasFiltrados = dias.filter(d => {
            if (sem === 'todas') return true;
            // Verifica se pelo menos um vendedor ativo tem esse dia na semana correta
            let naSemana = false;
            Object.keys(dadosVend).forEach(v => {
                const diaDados = dadosVend[v].diario[d];
                if (diaDados && diaDados.semana === sem) naSemana = true;
            });
            return naSemana;
        });
        
        chartData.labels = diasFiltrados;
        
        if (vend === 'todos') {
            // Tendências de todos os vendedores ativos
            const datasets = [];
            Object.keys(dadosVend).forEach(v => {
                const vDiaKm = diasFiltrados.map(d => {
                    const diaDados = dadosVend[v].diario[d];
                    return diaDados ? diaDados.km : 0;
                });
                
                datasets.push({
                    label: v.toUpperCase(),
                    data: vDiaKm,
                    borderColor: CORES_VENDEDORES[v]?.hex || CORES_VENDEDORES['padrao'].hex,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 3
                });
            });
            chartData.datasets = datasets;
        } else {
            // Apenas do vendedor selecionado
            const vDiaKm = diasFiltrados.map(d => {
                const diaDados = dadosVend[vend].diario[d];
                return diaDados ? diaDados.km : 0;
            });
            
            chartData.datasets = [
                {
                    label: `Km Diários - ${vend.toUpperCase()}`,
                    data: vDiaKm,
                    borderColor: CORES_VENDEDORES[vend]?.hex || CORES_VENDEDORES['padrao'].hex,
                    backgroundColor: CORES_VENDEDORES[vend]?.hex + '1a', // Preenchimento suave translúcido
                    fill: true,
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: CORES_VENDEDORES[vend]?.hex
                }
            ];
        }
        
        chartOptions.scales.y.title = { display: true, text: 'Quilômetros (km)', color: '#94a3b8' };
    }
    
    // Renderiza o novo gráfico
    chartInstance = new Chart(ctx, {
        type: chartType,
        data: chartData,
        options: chartOptions
    });
}
