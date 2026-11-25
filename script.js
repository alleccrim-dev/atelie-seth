/* ==========================================================================
   Ateliê Seth — Arquivo de Artes-Finais · Acervo
   Mesa de luz: espalhamento, arrastar/lançar com física, visualização
   com ficha técnica e organização (Livre / Ordenado / Tamanho).
   ========================================================================== */

(() => {
  "use strict";

  /* ------------------------------------------------------------------------
     1. DADOS
     Vêm de acervo.js (window.ACERVO), carregado antes deste arquivo.
     Cada peça ganha `dimensoes: { largura, altura }` em mm, decididas a
     partir de `medidas` e da orientação do scan (ver orientar()).
     ------------------------------------------------------------------------ */
  const ACERVO = window.ACERVO || [];

  /* ------------------------------------------------------------------------
     2. CONFIGURAÇÃO
     ------------------------------------------------------------------------ */
  const CONFIG = {
    margem: 48,              // respiro mínimo nas laterais (px; 20 em telas estreitas)
    respiro: 20,             // distância entre as peças e o cabeçalho/controles (px)
    ocupacao: 0.42,          // fração da área útil coberta pelas peças (0–1)
    ladoMinimo: 48,          // menor lado da menor peça na mesa livre (px; 28 em telas estreitas).
                             // Sobe a escala de TODAS as peças juntas: a proporção real é mantida.
    rotacaoMax: 4,           // micro-rotação inicial máxima (graus, ±)
    tentativas: 60,          // candidatos testados por peça no espalhamento
    sobreposicaoMax: 0.18,   // fração máxima da peça que pode ficar coberta
    limiarArrasto: 4,        // px de movimento para diferenciar clique de arrasto

    grade: {
      gapX: 28,              // espaço horizontal entre peças (px)
      gapY: 14,              // espaço vertical entre linhas (px)
      rotulo: 22,            // altura reservada ao número de tombo (px)
      duracao: 750,          // duração da transição entre modos (ms)
      escalonamento: 14      // atraso entre uma peça e a seguinte (ms)
    },

    fisica: {
      atrito: 650,           // ms: quanto maior, mais a peça desliza depois de solta
      deslizeRandomizar: 0.35,// multiplica o atrito no Randomizar (maior = deslize mais longo;
                              // 0.35 ≈ 0,7 s até assentar, rápido mas sem parada seca)
      restituicao: 0.82,     // energia mantida ao bater na borda (1 = DVD sem perda)
      velocidadeMax: 5,      // px/ms: limite da velocidade de lançamento
      inclinacao: 5,         // graus de inclinação por px/ms durante o arrasto
      inclinacaoMax: 10,     // graus
      giro: 0.014,           // giro (graus/ms) ganho ao lançar, por px/ms
      rotacaoLimite: 25,     // rotação máxima acumulada (graus, ±)
      escalaLevantada: 1.035,// "levanta" o papel ao arrastar
      elastico: 0.35,        // resistência ao puxar além da borda (0–1)
      // molas (unidades por ms²): inclinação balança um pouco; posição quase sem sobra
      molaInclK: 0.0006,  molaInclC: 0.028,
      molaPosK: 0.00028,  molaPosC: 0.029
    }
  };

  /* ------------------------------------------------------------------------
     3. ESTADO
     ------------------------------------------------------------------------ */
  const canvas = document.getElementById("canvas");
  // Camada que recebe o zoom/pan; as peças vivem dentro dela, em
  // "coordenadas de mesa" (iguais às da tela quando a escala é 1).
  const mesa = document.createElement("div");
  mesa.className = "mesa";
  canvas.appendChild(mesa);
  const vista = { escala: 1, x: 0, y: 0 };
  const contador = document.getElementById("piece-count");
  const header = document.querySelector(".site-header");
  const controles = document.querySelector(".controls");

  // Cada peça: { dados, el, x, y, w, h, rot,          ← posição atual
  //              tilt, vt, s,                         ← inclinação/escala dinâmicas
  //              vx, vy, vr, voando, arrastando, alvo ← física
  //              disp, slot }                         ← arranjo livre guardado / lugar ordenado
  const pecas = [];
  let zTopo = 1;
  let modo = "livre";        // "livre" | "id" | "tamanho"
  let sentidoTamanho = 1;    // 1 = menor → maior · -1 = maior → menor

  /* ------------------------------------------------------------------------
     4. UTILITÁRIOS
     ------------------------------------------------------------------------ */
  const aleatorio = (min, max) => min + Math.random() * (max - min);
  const limitar = (v, min, max) => Math.min(Math.max(v, min), max);
  const movimentoReduzido = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Área de interseção entre dois retângulos {x, y, w, h}
  function intersecao(a, b) {
    const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return dx > 0 && dy > 0 ? dx * dy : 0;
  }

  // Placeholder SVG simulando uma arte-final em nanquim sobre papel
  function gerarPlaceholder(dados, indice) {
    const { largura, altura } = dados.dimensoes;
    const W = Math.round(largura * 3); // mm → px do SVG
    const H = Math.round(altura * 3);
    const m = Math.min(W, H) * 0.08;
    const fonte = Math.min(W, H) * 0.12;

    const formas = [
      `<circle cx="${W / 2}" cy="${H * 0.45}" r="${Math.min(W, H) * 0.22}" fill="none" stroke="#111" stroke-width="${m * 0.35}"/>`,
      `<rect x="${W * 0.25}" y="${H * 0.25}" width="${W * 0.5}" height="${H * 0.35}" fill="#111"/>`,
      `<path d="M${m * 2} ${H * 0.65} Q ${W / 2} ${H * 0.1} ${W - m * 2} ${H * 0.65}" fill="none" stroke="#111" stroke-width="${m * 0.3}"/>`,
      `<line x1="${m * 2}" y1="${H * 0.45}" x2="${W - m * 2}" y2="${H * 0.45}" stroke="#111" stroke-width="${m * 0.6}"/>`,
      `<polygon points="${W / 2},${H * 0.18} ${W * 0.72},${H * 0.62} ${W * 0.28},${H * 0.62}" fill="none" stroke="#111" stroke-width="${m * 0.3}"/>`
    ];

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        <rect width="${W}" height="${H}" fill="#f6f3ec"/>
        <rect x="${m}" y="${m}" width="${W - m * 2}" height="${H - m * 2}" fill="none" stroke="#111" stroke-width="${m * 0.12}"/>
        ${formas[indice % formas.length]}
        <text x="${W / 2}" y="${H - m * 1.8}" text-anchor="middle"
              font-family="Helvetica, Arial, sans-serif" font-weight="700"
              font-size="${fonte}" fill="#111" letter-spacing="1">${dados.id}</text>
        <text x="${W - m * 1.2}" y="${m * 0.75}" text-anchor="end"
              font-family="Helvetica, Arial, sans-serif" font-size="${fonte * 0.32}"
              fill="#9a9488">${largura} × ${altura} mm</text>
      </svg>`;

    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.trim());
  }

  /* ------------------------------------------------------------------------
     5. CRIAÇÃO DOS ELEMENTOS
     ------------------------------------------------------------------------ */
  function criarPecas() {
    ACERVO.forEach((dados, i) => {
      const el = document.createElement("figure");
      el.className = "piece";
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${dados.id} — ${dados.datacao}`);
      el.dataset.id = dados.id;

      // Até o scan carregar, vale a ordem da ficha
      const [a, b] = dados.medidas;
      dados.dimensoes = { largura: a, altura: b };

      const img = document.createElement("img");
      img.alt = `Arte-final ${dados.id}` + (dados.descricao && dados.descricao !== "Nulo" ? ` — ${dados.descricao}` : "");
      img.draggable = false;
      img.decoding = "async";

      const rotulo = document.createElement("figcaption");
      rotulo.className = "piece__label";
      rotulo.textContent = dados.id;

      el.append(img, rotulo);
      mesa.appendChild(el);

      const peca = {
        dados, el, img,
        temScan: false,
        x: 0, y: 0, w: 0, h: 0, rot: 0,
        tilt: 0, vt: 0, s: 1,
        vx: 0, vy: 0, vr: 0,
        voando: false, arrastando: false, alvo: null,
        disp: null, slot: null, amostras: []
      };
      pecas.push(peca);
      ativarArrasto(peca);
    });

    contador.textContent = ACERVO.length;
  }

  // Carrega o scan; se ele não existir (ainda), usa o placeholder.
  function carregarImagem(p, i) {
    return new Promise(resolve => {
      const reserva = () => {
        p.img.onerror = null;
        p.img.onload = () => resolve();
        p.img.src = gerarPlaceholder(p.dados, i);
      };
      if (!p.dados.imagem) { reserva(); return; }
      p.img.onload = () => {
        p.temScan = true;
        p.el.classList.add("tem-scan"); // scan recortado: sombra segue o contorno
        orientar(p);
        resolve();
      };
      p.img.onerror = reserva;
      p.img.src = p.dados.imagem;
    });
  }

  // A ficha nem sempre lista largura × altura nessa ordem. Se o scan está
  // "deitado" e a medida "em pé" (ou o contrário), inverte as medidas.
  function orientar(p) {
    const [a, b] = p.dados.medidas;
    if (a === b) return;
    const scanDeitado = p.img.naturalWidth > p.img.naturalHeight;
    const medidaDeitada = a > b;
    p.dados.dimensoes = scanDeitado === medidaDeitada
      ? { largura: a, altura: b }
      : { largura: b, altura: a };
  }

  /* ------------------------------------------------------------------------
     6. ÁREA ÚTIL E DIMENSIONAMENTO
     A área útil desvia do cabeçalho e dos controles (que descem para a
     base da tela em telas estreitas).
     ------------------------------------------------------------------------ */
  function areaUtil() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const margem = W < 700 ? 20 : CONFIG.margem;
    let topo = header.getBoundingClientRect().bottom + CONFIG.respiro;
    let base = H - margem;

    const rc = controles.getBoundingClientRect();
    if (rc.top > H / 2) base = Math.min(base, rc.top - CONFIG.respiro);
    else topo = Math.max(topo, rc.bottom + CONFIG.respiro);

    return { x: margem, y: topo, w: W - margem * 2, h: Math.max(100, base - topo) };
  }

  // Um único px/mm para todas as peças: os tamanhos na tela são
  // proporcionais aos tamanhos reais. A escala faz o conjunto ocupar
  // ~CONFIG.ocupacao da área útil, sobe se a menor peça ficar pequena
  // demais e nunca deixa uma peça passar de 45% da largura/altura úteis.
  function dimensionar() {
    const area = areaUtil();
    const areaMm2 = pecas.reduce(
      (soma, p) => soma + p.dados.dimensoes.largura * p.dados.dimensoes.altura,
      0
    );
    let escala = Math.sqrt((area.w * area.h * CONFIG.ocupacao) / areaMm2);

    const menorLado = Math.min(...pecas.map(p =>
      Math.min(p.dados.dimensoes.largura, p.dados.dimensoes.altura)));
    const minimo = window.innerWidth < 700 ? 28 : CONFIG.ladoMinimo;
    escala = Math.max(escala, minimo / menorLado);

    pecas.forEach(p => {
      const { largura, altura } = p.dados.dimensoes;
      escala = Math.min(escala, (area.w * 0.45) / largura, (area.h * 0.45) / altura);
    });

    pecas.forEach(p => {
      const { largura, altura } = p.dados.dimensoes;
      const w = largura * escala;
      const h = altura * escala;
      p.w = Math.round(w);
      p.h = Math.round(h);
      p.el.style.width = p.w + "px";
      p.el.style.height = p.h + "px";
    });
  }

  /* ------------------------------------------------------------------------
     7. ESPALHAMENTO
     Para cada peça (das maiores para as menores), testa vários candidatos
     aleatórios e escolhe o que menos se sobrepõe às já posicionadas,
     com leve preferência por espaços vazios. Retorna os destinos sem
     aplicá-los: quem chama decide se entra direto ou com animação.
     ------------------------------------------------------------------------ */
  function calcularEspalhamento() {
    const area = areaUtil();
    const posicionadas = [];
    const destinos = new Map();
    const ordem = [...pecas].sort((a, b) => b.w * b.h - a.w * a.h);

    ordem.forEach(p => {
      let melhor = null;
      let melhorNota = Infinity;

      for (let t = 0; t < CONFIG.tentativas; t++) {
        const cand = {
          x: aleatorio(area.x, Math.max(area.x, area.x + area.w - p.w)),
          y: aleatorio(area.y, Math.max(area.y, area.y + area.h - p.h)),
          w: p.w,
          h: p.h
        };

        let sobreposicao = 0;
        let piorFracao = 0;
        let distMin = Infinity;
        const cx = cand.x + cand.w / 2;
        const cy = cand.y + cand.h / 2;

        for (const o of posicionadas) {
          const a = intersecao(cand, o);
          sobreposicao += a;
          piorFracao = Math.max(piorFracao, a / (cand.w * cand.h), a / (o.w * o.h));
          const d = Math.hypot(cx - (o.x + o.w / 2), cy - (o.y + o.h / 2));
          distMin = Math.min(distMin, d);
        }

        const excesso = Math.max(0, piorFracao - CONFIG.sobreposicaoMax);
        const nota =
          excesso * 1e7 +
          sobreposicao +
          (posicionadas.length ? -Math.min(distMin, 600) * 2 : 0);

        if (nota < melhorNota) {
          melhorNota = nota;
          melhor = cand;
        }
      }

      posicionadas.push(melhor);
      destinos.set(p, {
        ...melhor,
        rot: aleatorio(-CONFIG.rotacaoMax, CONFIG.rotacaoMax)
      });
    });

    return destinos;
  }

  function empilharAleatorio() {
    [...pecas]
      .sort(() => Math.random() - 0.5)
      .forEach(p => { p.el.style.zIndex = ++zTopo; });
  }

  // Entrada inicial: posiciona direto e faz o fade escalonado
  function espalharInicial() {
    const destinos = calcularEspalhamento();
    empilharAleatorio();
    pecas.forEach((p, i) => {
      definirPosicao(p, destinos.get(p));
      setTimeout(() => p.el.classList.add("is-placed"), 60 * i);
    });
  }

  // Botão "Randomizar" / tecla R: cada peça é "lançada" na direção da nova
  // posição e desliza com o mesmo atrito do arrasto, perdendo velocidade aos
  // poucos até parar exatamente no destino (sem parada seca).
  // Numa desaceleração exponencial, a distância total percorrida é
  // velocidade inicial × constante de atrito; daí v0 = distância ÷ atrito.
  //
  // Randomizar de novo no meio do deslize não freia nada: cada peça segue
  // com o embalo que tem e só muda de rumo para o novo destino.
  function randomizar() {
    if (modo !== "livre" || aberta || festa) return;
    resetVista(true);
    pecas.forEach(p => {
      clearTimeout(p.timerRand); // cancela só o lançamento que ainda não saiu
      pararMovimento(p);         // transição de modo (CSS), se houver
      p.alvo = null;
    });
    const destinos = calcularEspalhamento();
    empilharAleatorio();

    if (movimentoReduzido()) {
      pecas.forEach(p => definirPosicao(p, destinos.get(p)));
      return;
    }

    const tau = CONFIG.fisica.atrito * CONFIG.fisica.deslizeRandomizar;
    [...pecas].sort(() => Math.random() - 0.5).forEach((p, i) => {
      const d = destinos.get(p);
      p.timerRand = setTimeout(() => {
        if (p.arrastando) return; // peça na mão do usuário: deixa quieta
        p.vx = (d.x - p.x) / tau;
        p.vy = (d.y - p.y) / tau;
        p.vr = (d.rot - p.rot) / tau;
        p.tau = tau;          // atrito próprio deste deslize
        p.voando = true;
        acordar(p);
      }, i * 6); // escalonamento curto: todas saem em ~0,2 s
    });
  }

  /* ------------------------------------------------------------------------
     8. POSIÇÃO E TRANSFORM
     ------------------------------------------------------------------------ */
  function aplicarTransform(p) {
    p.el.style.transform =
      `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot + p.tilt}deg) scale(${p.s})`;
  }

  function definirPosicao(p, r) {
    p.x = r.x;
    p.y = r.y;
    p.w = Math.round(r.w);
    p.h = Math.round(r.h);
    p.rot = r.rot;
    p.el.style.width = p.w + "px";
    p.el.style.height = p.h + "px";
    aplicarTransform(p);
  }

  function trazerParaFrente(p) {
    p.el.style.zIndex = ++zTopo;
  }

  // Mantém a peça inteira dentro da tela (usado no redimensionamento)
  function manterNaTela(r) {
    r.x = limitar(r.x, 0, Math.max(0, window.innerWidth - r.w));
    r.y = limitar(r.y, 0, Math.max(0, window.innerHeight - r.h));
  }

  /* ------------------------------------------------------------------------
     9. FÍSICA
     Um único laço de animação (requestAnimationFrame) cuida só das peças
     que estão em movimento e para sozinho quando todas assentam.
     - Arrastando: a peça segue o dedo/cursor, levanta (escala) e inclina
       conforme a velocidade e o ponto onde foi pega.
     - Solta no modo Livre: continua com a velocidade do lançamento,
       desacelera pelo atrito e quica nas bordas da tela.
     - Solta nos modos ordenados: uma mola leva a peça de volta ao lugar.
     ------------------------------------------------------------------------ */
  const ativos = new Set();
  let rafId = 0;
  let ultimoT = 0;

  function acordar(p) {
    ativos.add(p);
    if (!rafId) {
      ultimoT = performance.now();
      rafId = requestAnimationFrame(passo);
    }
  }

  function passo(t) {
    const dt = Math.min(32, Math.max(1, t - ultimoT));
    ultimoT = t;
    for (const p of ativos) {
      if (!simular(p, dt)) ativos.delete(p);
    }
    rafId = ativos.size ? requestAnimationFrame(passo) : 0;
  }

  function pararFisica(p) {
    clearTimeout(p.timerRand);
    p.tau = 0;
    ativos.delete(p);
    p.voando = false;
    p.arrastando = false;
    p.alvo = null;
    p.vx = p.vy = p.vr = p.vt = 0;
    p.tilt = 0;
    p.s = 1;
  }

  // Velocidade do ponteiro a partir das amostras dos últimos 100 ms
  function atualizarVelocidade(p) {
    const agora = performance.now();
    p.amostras = p.amostras.filter(a => agora - a.t <= 100);
    const a = p.amostras;
    if (a.length < 2) { p.vx = p.vy = 0; return; }
    const f = a[0];
    const l = a[a.length - 1];
    const dt = Math.max(l.t - f.t, 8);
    p.vx = (l.x - f.x) / dt;
    p.vy = (l.y - f.y) / dt;
  }

  // Meia-largura/altura da caixa que envolve a peça girada
  function caixa(p) {
    const r = ((p.rot + p.tilt) * Math.PI) / 180;
    const c = Math.abs(Math.cos(r));
    const s = Math.abs(Math.sin(r));
    return {
      hw: ((p.w * c + p.h * s) / 2) * p.s,
      hh: ((p.w * s + p.h * c) / 2) * p.s
    };
  }

  // Resistência elástica ao puxar além da borda
  function elastico(v, min, max) {
    const k = CONFIG.fisica.elastico;
    if (v < min) return min - (min - v) * k;
    if (v > max) return max + (v - max) * k;
    return v;
  }

  // Batida nas bordas da tela. Retorna true se ainda há peça fora da borda.
  function quicar(p, dt) {
    const F = CONFIG.fisica;
    const restituicao = festa ? 1 : F.restituicao; // na festa: quique de DVD, sem perda
    const W = window.innerWidth;
    const H = window.innerHeight;
    const { hw, hh } = caixa(p);
    let cx = p.x + p.w / 2;
    let cy = p.y + p.h / 2;
    let fora = false;

    const bater = (eixo, lado) => {
      // eixo: "x" | "y"; lado: -1 (esquerda/topo) | 1 (direita/base)
      const v = eixo === "x" ? p.vx : p.vy;
      const limite = eixo === "x" ? (lado < 0 ? hw : W - hw) : (lado < 0 ? hh : H - hh);
      const pos = eixo === "x" ? cx : cy;
      const penetracao = (pos - limite) * lado; // > 0: está além da borda
      if (penetracao <= 0) return;

      if (v * lado > 0.3) {
        // Batida de verdade: encosta na borda e volta, como o logo do DVD
        if (eixo === "x") { cx = limite; p.vx = -p.vx * restituicao; }
        else { cy = limite; p.vy = -p.vy * restituicao; }
        const impacto = Math.min(Math.abs(v), 3);
        const outra = eixo === "x" ? p.vy : p.vx;
        p.vt += (Math.sign(outra * lado) || 1) * impacto * 0.05; // balanço
        p.vr *= -0.5;
      } else {
        // Devagar e além da borda (ex.: soltou esticando o elástico): mola de volta
        const empurrao = -lado * penetracao * 0.0009 * dt;
        if (eixo === "x") p.vx += empurrao; else p.vy += empurrao;
        fora = true;
      }
    };

    bater("x", -1); bater("x", 1);
    bater("y", -1); bater("y", 1);
    p.x = cx - p.w / 2;
    p.y = cy - p.h / 2;
    return fora;
  }

  function simular(p, dt) {
    const F = CONFIG.fisica;
    let vivo = false;

    if (p.arrastando) {
      atualizarVelocidade(p);
      vivo = true;
    }

    // Inclinação: durante o arrasto segue a velocidade (e o ponto de pega);
    // depois, a mola devolve a 0 com um pequeno balanço.
    let alvoIncl = 0;
    if (p.arrastando) {
      const torque = p.vx * 0.4 + (-p.pegaY * p.vx + p.pegaX * p.vy);
      alvoIncl = limitar(torque * F.inclinacao, -F.inclinacaoMax, F.inclinacaoMax);
    }
    p.vt += (F.molaInclK * (alvoIncl - p.tilt) - F.molaInclC * p.vt) * dt;
    p.tilt += p.vt * dt;
    if (Math.abs(p.tilt - alvoIncl) > 0.05 || Math.abs(p.vt) > 0.002) vivo = true;
    else if (!p.arrastando) { p.tilt = 0; p.vt = 0; }

    // Escala: levanta ao arrastar, pousa ao soltar
    const alvoS = p.arrastando ? F.escalaLevantada : 1;
    p.s += (alvoS - p.s) * (1 - Math.exp(-dt / 90));
    if (Math.abs(alvoS - p.s) > 0.0005) vivo = true;
    else p.s = alvoS;

    // Deslize livre com atrito e batidas nas bordas
    if (!p.arrastando && p.voando) {
      const desacel = festa ? 1 : Math.exp(-dt / (p.tau || F.atrito)); // na festa, sem atrito
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.vx *= desacel;
      p.vy *= desacel;
      p.vr *= desacel;

      if (Math.abs(p.rot) > F.rotacaoLimite) {
        p.rot = Math.sign(p.rot) * F.rotacaoLimite;
        p.vr = festa ? -p.vr : 0;
      }

      const fora = quicar(p, dt);
      if (!fora && Math.hypot(p.vx, p.vy) < 0.01 && Math.abs(p.vr) < 0.0005) {
        p.voando = false;
        p.tau = 0;
        p.vx = p.vy = p.vr = 0;
      } else {
        vivo = true;
      }
    }

    // Mola de volta ao lugar (modos ordenados)
    if (!p.arrastando && p.alvo) {
      const k = F.molaPosK;
      const c = F.molaPosC;
      p.vx += (k * (p.alvo.x - p.x) - c * p.vx) * dt;
      p.vy += (k * (p.alvo.y - p.y) - c * p.vy) * dt;
      p.vr += (k * (p.alvo.rot - p.rot) - c * p.vr) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;

      const perto =
        Math.hypot(p.alvo.x - p.x, p.alvo.y - p.y) < 0.3 &&
        Math.hypot(p.vx, p.vy) < 0.005 &&
        Math.abs(p.alvo.rot - p.rot) < 0.05;
      if (perto) {
        p.x = p.alvo.x; p.y = p.alvo.y; p.rot = p.alvo.rot;
        p.vx = p.vy = p.vr = 0;
        p.alvo = null;
      } else {
        vivo = true;
      }
    }

    aplicarTransform(p);
    return vivo;
  }

  /* ------------------------------------------------------------------------
     10. ARRASTAR, LANÇAR E CLICAR (Pointer Events: mouse, toque e caneta)
     ------------------------------------------------------------------------ */
  function ativarArrasto(p) {
    let inicio = null; // { px, py, x, y, id }

    p.el.addEventListener("pointerdown", e => {
      if (e.button !== 0) return; // apenas botão principal
      e.preventDefault();
      pararMovimento(p);          // interrompe transição de modo, se houver
      p.el.setPointerCapture(e.pointerId);
      trazerParaFrente(p);

      // "Pega" a peça no ar, se estiver deslizando (ou prestes a deslizar)
      clearTimeout(p.timerRand);
      p.tau = 0;
      p.voando = false;
      p.alvo = null;
      p.vx = p.vy = p.vr = 0;

      // Ponteiro convertido para coordenadas de mesa (desfaz pan e zoom),
      // para o cursor continuar grudado no ponto exato onde a peça foi pega.
      const m = paraMesa(e.clientX, e.clientY);

      // Onde a peça foi pega, de -1 a 1 a partir do centro (gera o giro)
      p.pegaX = limitar((m.x - (p.x + p.w / 2)) / (p.w / 2), -1, 1);
      p.pegaY = limitar((m.y - (p.y + p.h / 2)) / (p.h / 2), -1, 1);

      inicio = {
        sx: e.clientX, sy: e.clientY, // tela: limiar clique × arrasto
        mx: m.x, my: m.y,             // mesa: deslocamento da peça
        x: p.x, y: p.y, id: e.pointerId
      };
      p.amostras = [{ t: performance.now(), x: m.x, y: m.y }];
      p.arrastando = false;
    });

    p.el.addEventListener("pointermove", e => {
      if (!inicio || e.pointerId !== inicio.id) return;
      if (!p.arrastando &&
          Math.hypot(e.clientX - inicio.sx, e.clientY - inicio.sy) < CONFIG.limiarArrasto) return;

      const m = paraMesa(e.clientX, e.clientY);
      const dx = m.x - inicio.mx;
      const dy = m.y - inicio.my;

      if (!p.arrastando) {
        p.arrastando = true;
        p.el.classList.add("is-dragging");
        document.body.classList.add("is-dragging");
        acordar(p);
      }

      p.amostras.push({ t: performance.now(), x: m.x, y: m.y });

      // Segue o ponteiro, com resistência elástica além das bordas da tela
      const { hw, hh } = caixa(p);
      const cx = elastico(inicio.x + dx + p.w / 2, hw, window.innerWidth - hw);
      const cy = elastico(inicio.y + dy + p.h / 2, hh, window.innerHeight - hh);
      p.x = cx - p.w / 2;
      p.y = cy - p.h / 2;
      aplicarTransform(p);
    });

    const finalizar = e => {
      if (!inicio || e.pointerId !== inicio.id) return;
      if (p.el.hasPointerCapture(e.pointerId)) p.el.releasePointerCapture(e.pointerId);

      if (p.arrastando) {
        atualizarVelocidade(p);
        p.arrastando = false;
        p.el.classList.remove("is-dragging");
        document.body.classList.remove("is-dragging");

        if (modo === "livre") {
          // Lançamento: mantém a velocidade (limitada) e ganha giro
          const F = CONFIG.fisica;
          const vel = Math.hypot(p.vx, p.vy);
          if (vel > F.velocidadeMax) {
            p.vx *= F.velocidadeMax / vel;
            p.vy *= F.velocidadeMax / vel;
          }
          p.vr = F.giro * (-p.pegaY * p.vx + p.pegaX * p.vy);
          p.voando = true;
        } else {
          // Ordenado / Tamanho: volta ao seu lugar com uma mola
          p.vx = p.vy = p.vr = 0;
          p.alvo = p.slot;
        }
        acordar(p);
      } else if (e.type === "pointerup") {
        aoClicar(p); // clique simples, sem arrasto
      }

      inicio = null;
    };

    p.el.addEventListener("pointerup", finalizar);
    p.el.addEventListener("pointercancel", finalizar);

    // Teclado: Enter abre a peça (Espaço é reservado ao reset do zoom)
    p.el.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        trazerParaFrente(p);
        aoClicar(p);
      }
    });
  }

  // Clique simples (sem arrasto) abre a visualização em destaque
  function aoClicar(p) {
    abrirVisualizacao(p);
  }

  /* ------------------------------------------------------------------------
     11. VISUALIZAÇÃO EM DESTAQUE + FICHA TÉCNICA
     A imagem "levanta" da mesa: sai da posição exata da peça (com a
     rotação) e cresce até o centro (técnica FLIP). Ao fechar, volta
     para onde estava.
     ------------------------------------------------------------------------ */

  // Campos exibidos na ficha, na ordem. [chave, rótulo, formatador opcional]
  // (A tecnologia de reprodução fica de fora por enquanto.)
  const numeroBR = n => Number(n).toLocaleString("pt-BR");
  const FICHA = [
    ["datacao",   "Datação"],
    ["descricao", "Descrição da ilustração"],
    ["texto",     "Texto ou slogan"],
    ["suporte",   "Suporte material"],
    ["medidas",   "Medidas", m => `${numeroBR(m[0])} × ${numeroBR(m[1])} mm`],
    ["tecnica",   "Técnicas de execução"],
    ["marcas",    "Marcas da peça (refinamento e guia)"],
    ["escrita",   "Escrita gráfica"],
    ["linguagem", "Linguagem"],
    ["tipologia", "Tipologia da peça publicitária"]
  ];

  const V = {
    el:      document.getElementById("viewer"),
    stage:   document.getElementById("viewer-stage"),
    img:     document.getElementById("viewer-image"),
    sheet:   document.getElementById("viewer-sheet"),
    title:   document.getElementById("viewer-title"),
    list:    document.getElementById("viewer-list"),
    counter: document.getElementById("viewer-counter"),
    prev:    document.getElementById("viewer-prev"),
    next:    document.getElementById("viewer-next"),
    close:   document.getElementById("viewer-close")
  };

  const ANIM = {
    duracao: 560,
    easing: "cubic-bezier(0.2, 0.7, 0.1, 1)"
  };

  let aberta = null;       // peça em destaque
  let animando = false;
  let focoAnterior = null;

  // Proporção física (medidas da ficha): usada nos tamanhos e layouts da mesa
  function proporcaoFisica(p) {
    return p.dados.dimensoes.largura / p.dados.dimensoes.altura;
  }

  // Proporção do arquivo de imagem: usada no visualizador, para não distorcer o scan
  function proporcao(p) {
    const img = p.img;
    if (img.naturalWidth && img.naturalHeight) return img.naturalWidth / img.naturalHeight;
    return proporcaoFisica(p);
  }

  // Retângulo final da imagem: o maior possível dentro da área do palco
  function retanguloFinal(p) {
    const r = V.stage.getBoundingClientRect();
    const cs = getComputedStyle(V.stage);
    const pt = parseFloat(cs.paddingTop), pr = parseFloat(cs.paddingRight);
    const pb = parseFloat(cs.paddingBottom), pl = parseFloat(cs.paddingLeft);
    const bw = r.width - pl - pr;
    const bh = r.height - pt - pb;
    const ar = proporcao(p);
    let w = bw, h = w / ar;
    if (h > bh) { h = bh; w = h * ar; }
    return { x: r.left + pl + (bw - w) / 2, y: r.top + pt + (bh - h) / 2, w, h };
  }

  function posicionarImagem(rect) {
    Object.assign(V.img.style, {
      left: rect.x + "px",
      top: rect.y + "px",
      width: rect.w + "px",
      height: rect.h + "px"
    });
  }

  // Transform que leva o retângulo final de volta à posição da peça na mesa
  // (a peça está em coordenadas de mesa; converte para a tela com o zoom atual)
  function transformDaPeca(p, f) {
    const k = vista.escala;
    const dx = vista.x + (p.x + p.w / 2) * k - (f.x + f.w / 2);
    const dy = vista.y + (p.y + p.h / 2) * k - (f.y + f.h / 2);
    return `translate(${dx}px, ${dy}px) rotate(${p.rot + p.tilt}deg) scale(${(p.w * p.s * k) / f.w}, ${(p.h * p.s * k) / f.h})`;
  }

  function preencherFicha(p) {
    const d = p.dados;
    V.title.textContent = d.id;
    V.img.src = p.el.querySelector("img").src;
    V.img.alt = p.img.alt;

    V.list.replaceChildren();
    FICHA.forEach(([chave, rotulo, formatar]) => {
      const valor = d[chave];
      if (valor === undefined || valor === null || valor === "") return;
      const item = document.createElement("div");
      item.className = `sheet__item sheet__item--${chave}`;
      const dt = document.createElement("dt");
      dt.textContent = rotulo;
      const dd = document.createElement("dd");
      // "Nulo" na ficha = campo sem conteúdo; aparece como travessão
      dd.textContent = valor === "Nulo" ? "—" : formatar ? formatar(valor) : valor;
      item.append(dt, dd);
      V.list.appendChild(item);
    });

    const i = pecas.indexOf(p) + 1;
    const pad = n => String(n).padStart(2, "0");
    V.counter.textContent = `${pad(i)} / ${pad(pecas.length)}`;
    V.sheet.scrollTop = 0;
  }

  function abrirVisualizacao(p) {
    if (animando || aberta) return;
    aberta = p;
    animando = true;
    focoAnterior = document.activeElement;

    resetZoomViewer(false);
    preencherFicha(p);
    V.el.hidden = false;
    posicionarBotaoReset();
    document.body.classList.add("viewer-open");

    const final = retanguloFinal(p);
    posicionarImagem(final);
    const deOnde = transformDaPeca(p, final); // captura antes de assentar a peça
    pararFisica(p);
    aplicarTransform(p);
    p.el.style.visibility = "hidden"; // o papel "sai" da mesa

    void V.el.offsetWidth; // força o layout antes de ligar as transições
    V.el.classList.add("is-open");

    const anim = V.img.animate(
      [{ transform: deOnde }, { transform: "none" }],
      { duration: movimentoReduzido() ? 0 : ANIM.duracao, easing: ANIM.easing }
    );
    anim.onfinish = () => {
      animando = false;
      V.el.focus({ preventScroll: true });
      atualizarBotaoReset();
    };
  }

  function fecharVisualizacao() {
    if (animando || !aberta) return;
    const p = aberta;
    animando = true;
    resetZoomViewer(false); // volta a 1x antes da animação de saída (FLIP)

    const final = retanguloFinal(p);
    posicionarImagem(final);
    V.el.classList.remove("is-open");

    const anim = V.img.animate(
      [{ transform: "none" }, { transform: transformDaPeca(p, final) }],
      { duration: movimentoReduzido() ? 0 : ANIM.duracao * 0.85, easing: ANIM.easing, fill: "forwards" }
    );
    anim.onfinish = () => {
      p.el.style.visibility = "";
      V.el.hidden = true;
      anim.cancel();
      document.body.classList.remove("viewer-open");
      aberta = null;
      animando = false;
      if (focoAnterior && focoAnterior.focus) focoAnterior.focus({ preventScroll: true });
    };
  }

  // Navegação entre peças, na ordem do acervo (MPS 01 → MPS 31)
  function navegar(passo) {
    if (animando || !aberta) return;
    const atual = pecas.indexOf(aberta);
    const nova = pecas[(atual + passo + pecas.length) % pecas.length];
    resetZoomViewer(false); // volta a 1x antes da troca

    aberta.el.style.visibility = "";
    pararFisica(nova);
    aplicarTransform(nova);
    nova.el.style.visibility = "hidden";
    aberta = nova;
    focoAnterior = nova.el;

    preencherFicha(nova);
    posicionarImagem(retanguloFinal(nova));

    if (!movimentoReduzido()) {
      V.img.animate(
        [
          { opacity: 0, transform: `translateX(${passo * 24}px)` },
          { opacity: 1, transform: "none" }
        ],
        { duration: 320, easing: ANIM.easing }
      );
    }
  }

  // Fecha ao clicar fora da imagem, ou na imagem quando não há zoom.
  // Depois de um pan com zoom, o clique que encerra o arrasto é ignorado.
  V.el.addEventListener("click", e => {
    if (ZV.ignorarClique) { ZV.ignorarClique = false; return; }
    if (e.target.hasAttribute("data-close")) fecharVisualizacao();
    else if (e.target === V.img && ZV.z <= 1.001) fecharVisualizacao();
  });
  V.close.addEventListener("click", fecharVisualizacao);
  V.prev.addEventListener("click", () => navegar(-1));
  V.next.addEventListener("click", () => navegar(1));

  // Teclado: Esc fecha, setas navegam, Tab fica preso dentro do modal
  document.addEventListener("keydown", e => {
    if (!aberta) return;
    if (e.key === "Escape") { e.preventDefault(); fecharVisualizacao(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); navegar(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); navegar(1); }
    else if (e.key === "Tab") {
      const focaveis = [V.close, V.sheet, V.prev, V.next];
      const acoesVisiveis = [botaoReset, botaoVirar].filter(b => b.tabIndex === 0);
      focaveis.splice(1, 0, ...acoesVisiveis);
      const i = focaveis.indexOf(document.activeElement);
      e.preventDefault();
      const prox = e.shiftKey
        ? focaveis[(i - 1 + focaveis.length) % focaveis.length]
        : focaveis[(i + 1) % focaveis.length];
      prox.focus();
    }
  });
  V.sheet.tabIndex = 0;
  V.el.tabIndex = -1;

  window.addEventListener("resize", () => {
    if (aberta && !animando) {
      resetZoomViewer(false);
      posicionarImagem(retanguloFinal(aberta));
      posicionarBotaoReset();
    }
  });

  /* ------------------------------------------------------------------------
     12. ORGANIZAÇÃO: LIVRE / ORDENADO / TAMANHO
     Ao sair do modo Livre, o arranjo (inclusive o que o usuário mexeu)
     é guardado em `p.disp` e restaurado ao voltar.
     ------------------------------------------------------------------------ */
  const botoesModo = document.querySelectorAll(".ctrl[data-modo]");
  const botaoTamanho = document.querySelector('.ctrl[data-modo="tamanho"]');
  const botaoRandomizar = document.getElementById("btn-randomizar");

  const numeroTombo = p => parseInt(p.dados.id.replace(/\D/g, ""), 10) || 0;
  const areaFisica = p => p.dados.dimensoes.largura * p.dados.dimensoes.altura;
  const porTombo = (a, b) => numeroTombo(a) - numeroTombo(b);

  function ordemAtual() {
    if (modo === "tamanho") {
      return [...pecas].sort(
        (a, b) => (areaFisica(a) - areaFisica(b)) * sentidoTamanho || porTombo(a, b)
      );
    }
    return [...pecas].sort(porTombo);
  }

  // ORDENADO: grade em que cada peça cabe inteira na sua célula.
  // Testa todas as quantidades de colunas e fica com a que deixa as peças
  // maiores, sem rolagem. Peças apoiadas na base: números alinhados.
  function layoutGrade(lista) {
    const area = areaUtil();
    const n = lista.length;
    const { gapX, gapY, rotulo } = CONFIG.grade;
    const encaixe = (p, cw, ch) => {
      const ar = proporcaoFisica(p);
      const w = Math.min(cw, ch * ar);
      return { w, h: w / ar };
    };

    let melhor = null;
    for (let cols = 1; cols <= n; cols++) {
      const linhas = Math.ceil(n / cols);
      const cw = (area.w - gapX * (cols - 1)) / cols;
      const ch = (area.h - gapY * (linhas - 1)) / linhas - rotulo;
      if (cw <= 0 || ch <= 0) continue;
      const soma = lista.reduce((s, p) => {
        const { w, h } = encaixe(p, cw, ch);
        return s + w * h;
      }, 0);
      if (!melhor || soma > melhor.soma) melhor = { cols, linhas, cw, ch, soma };
    }

    const { cols, linhas, cw, ch } = melhor;
    const totalW = cols * cw + gapX * (cols - 1);
    const totalH = linhas * (ch + rotulo) + gapY * (linhas - 1);
    const x0 = area.x + (area.w - totalW) / 2;
    const y0 = area.y + (area.h - totalH) / 2;

    lista.forEach((p, i) => {
      const c = i % cols;
      const l = Math.floor(i / cols);
      const { w, h } = encaixe(p, cw, ch);
      const celX = x0 + c * (cw + gapX);
      const celY = y0 + l * (ch + rotulo + gapY);
      p.slot = { x: celX + (cw - w) / 2, y: celY + (ch - h), w, h, rot: 0 };
    });
  }

  // TAMANHO: escala física real (mesmo px/cm para todas), em linhas,
  // da menor para a maior (ou o contrário). A escala é a maior que
  // faz o conjunto caber na tela sem rolagem.
  function layoutTamanho(lista) {
    const area = areaUtil();
    const { gapX, gapY, rotulo } = CONFIG.grade;
    const itens = lista.map(p => ({ p, mm: p.dados.dimensoes.largura, ar: proporcaoFisica(p) }));

    const montar = escala => {
      const linhas = [];
      let linha = [];
      let largura = 0;
      for (const it of itens) {
        const w = it.mm * escala;
        const h = w / it.ar;
        if (linha.length && largura + gapX + w > area.w) {
          linhas.push(linha);
          linha = [];
          largura = 0;
        }
        largura += (linha.length ? gapX : 0) + w;
        linha.push({ ...it, w, h });
      }
      if (linha.length) linhas.push(linha);
      const alturas = linhas.map(l => Math.max(...l.map(it => it.h)));
      const total = alturas.reduce((s, h) => s + h + rotulo, 0) + gapY * (linhas.length - 1);
      const cabe = total <= area.h && itens.every(it => it.mm * escala <= area.w);
      return { linhas, alturas, total, cabe };
    };

    // Busca binária pela maior escala que cabe
    let lo = 0.01, hi = 400;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (montar(mid).cabe) lo = mid; else hi = mid;
    }

    const r = montar(lo);
    let y = area.y + (area.h - r.total) / 2;
    r.linhas.forEach((linha, i) => {
      const lw = linha.reduce((s, it) => s + it.w, 0) + gapX * (linha.length - 1);
      let x = area.x + (area.w - lw) / 2;
      const hL = r.alturas[i];
      linha.forEach(it => {
        it.p.slot = { x, y: y + hL - it.h, w: it.w, h: it.h, rot: 0 };
        x += it.w + gapX;
      });
      y += hL + rotulo + gapY;
    });
  }

  function calcularLayout() {
    const lista = ordemAtual();
    if (modo === "tamanho") layoutTamanho(lista);
    else layoutGrade(lista);
    return lista;
  }

  function pararMovimento(p) {
    clearTimeout(p.timerMov);
    p.el.classList.remove("is-moving");
  }

  // Leva cada peça da lista até destino(p), com transição suave e escalonada
  function animarPara(lista, destino) {
    const dur = movimentoReduzido() ? 0 : CONFIG.grade.duracao;
    canvas.style.setProperty("--dur", dur + "ms");

    lista.forEach((p, i) => {
      const atraso = dur ? i * CONFIG.grade.escalonamento : 0;
      clearTimeout(p.timerMov);
      p.el.style.setProperty("--atraso", atraso + "ms");
      p.el.classList.add("is-moving");
      p.timerMov = setTimeout(() => p.el.classList.remove("is-moving"), dur + atraso + 50);
    });

    void canvas.offsetWidth; // garante que a transição esteja ativa antes de mover
    lista.forEach(p => definirPosicao(p, destino(p)));
  }

  function atualizarControles() {
    botoesModo.forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.modo === modo))
    );
    const crescente = sentidoTamanho === 1;
    botaoTamanho.querySelector(".ctrl__seta").textContent = crescente ? "↑" : "↓";
    botaoTamanho.setAttribute(
      "aria-label",
      `Tamanho, ${crescente ? "do menor para o maior" : "do maior para o menor"}`
    );
    botaoRandomizar.disabled = modo !== "livre";
    document.body.classList.toggle("modo-ordem", modo !== "livre");
  }

  function alternarModo(novo) {
    if (aberta || !pronto) return;

    // Clicar em "Tamanho" com ele já ativo inverte o sentido
    if (novo === "tamanho" && modo === "tamanho") sentidoTamanho *= -1;
    else if (novo === modo) return;

    encerrarFesta();
    resetVista(true);
    pecas.forEach(pararFisica);

    if (modo === "livre") {
      pecas.forEach(p => {
        p.disp = { x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot };
      });
    }

    modo = novo;
    atualizarControles();

    if (modo === "livre") {
      animarPara(ordemAtual(), p => p.disp);
    } else {
      const lista = calcularLayout();
      animarPara(lista, p => p.slot);
    }
  }

  botoesModo.forEach(b =>
    b.addEventListener("click", () => alternarModo(b.dataset.modo))
  );
  /* Easter egg: Randomizar (botão ou tecla R) 4x rápido → a mesa pisca de cor e as
     peças saem andando sozinhas, quicando nas paredes como o logo do DVD.
     Depois de ~9 s o atrito volta e elas param por volta dos 10 s.
     Dá para pegar uma peça no meio da festa. */
  const FESTA = { cliques: 4, janela: 1500, duracao: 9000 }; // 4 acionamentos em até 1,5 s
  let cliquesRandomizar = [];
  let festa = false;
  let timerFesta = 0;

  function iniciarFesta() {
    if (modo !== "livre" || aberta || movimentoReduzido()) return;
    festa = true;
    canvas.classList.add("festa");
    resetVista(true);
    pecas.forEach(p => {
      pararMovimento(p);
      pararFisica(p);
      const angulo = Math.random() * Math.PI * 2;
      const vel = aleatorio(0.6, 1.3); // px/ms
      p.vx = Math.cos(angulo) * vel;
      p.vy = Math.sin(angulo) * vel;
      p.vr = aleatorio(-0.08, 0.08);
      p.voando = true;
      acordar(p);
    });
    clearTimeout(timerFesta);
    timerFesta = setTimeout(encerrarFesta, FESTA.duracao);
  }

  // O atrito volta e as peças desaceleram até parar
  function encerrarFesta() {
    clearTimeout(timerFesta);
    if (!festa) return;
    festa = false;
    canvas.classList.remove("festa");
  }

  // Usado pelo botão e pela tecla R: conta os acionamentos rápidos
  function acionarRandomizar() {
    if (modo !== "livre" || aberta || !pronto) return;
    const agora = performance.now();
    cliquesRandomizar = cliquesRandomizar.filter(t => agora - t < FESTA.janela);
    cliquesRandomizar.push(agora);
    if (festa) return;
    if (cliquesRandomizar.length >= FESTA.cliques) {
      cliquesRandomizar = [];
      iniciarFesta();
    } else {
      randomizar();
    }
  }

  botaoRandomizar.addEventListener("click", acionarRandomizar);

  // Tecla R: mesmo comportamento do botão, inclusive o easter egg.
  // Segurar a tecla não conta (e.repeat): só apertos de verdade.
  window.addEventListener("keydown", e => {
    if (aberta || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.key === "r" || e.key === "R") acionarRandomizar();
  });

  /* ------------------------------------------------------------------------
     13. REDIMENSIONAMENTO DA JANELA
     Não reembaralha: reescala as peças e reposiciona proporcionalmente,
     preservando o arranjo feito pelo usuário.
     ------------------------------------------------------------------------ */
  let ultimaJanela = { w: window.innerWidth, h: window.innerHeight };
  let timerResize = null;

  window.addEventListener("resize", () => {
    if (!pronto) return;
    clearTimeout(timerResize);
    timerResize = setTimeout(() => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const fx = W / ultimaJanela.w;
      const fy = H / ultimaJanela.h;
      ultimaJanela = { w: W, h: H };

      encerrarFesta();
      pecas.forEach(p => { pararFisica(p); pararMovimento(p); });

      // Centros do arranjo livre (atual ou guardado), na nova escala
      pecas.forEach(p => {
        const r = modo === "livre" ? p : p.disp;
        p.cx = (r.x + r.w / 2) * fx;
        p.cy = (r.y + r.h / 2) * fy;
        p.rotLivre = r.rot;
      });
      dimensionar(); // tamanhos físicos da mesa livre
      pecas.forEach(p => {
        const r = { x: p.cx - p.w / 2, y: p.cy - p.h / 2, w: p.w, h: p.h, rot: p.rotLivre };
        manterNaTela(r);
        if (modo === "livre") definirPosicao(p, r);
        else p.disp = r;
      });

      if (modo !== "livre") {
        calcularLayout();
        pecas.forEach(p => definirPosicao(p, p.slot));
      }
    }, 150);
  });

  /* ------------------------------------------------------------------------
     14. ZOOM E PAN — utilitários comuns
     ------------------------------------------------------------------------ */
  // Interpolação com easing (ease-out cúbico). Retorna uma função que cancela.
  function tween(duracao, aoAtualizar, aoTerminar) {
    let id = 0;
    const t0 = performance.now();
    const quadro = t => {
      const k = duracao > 0 ? Math.min(1, (t - t0) / duracao) : 1;
      aoAtualizar(1 - Math.pow(1 - k, 3));
      if (k < 1) id = requestAnimationFrame(quadro);
      else if (aoTerminar) aoTerminar();
    };
    id = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(id);
  }

  // Fator de zoom de um evento wheel (mouse, trackpad e pinça com ctrl)
  function fatorRoda(e) {
    const unidade = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const k = e.ctrlKey ? 0.01 : 0.0015; // ctrlKey = gesto de pinça no trackpad
    return limitar(Math.exp(-e.deltaY * unidade * k), 0.5, 2);
  }

  /* ------------------------------------------------------------------------
     15. ZOOM E PAN DA MESA DE LUZ (#canvas)
     - Roda do mouse: zoom ancorado no cursor (1x a 4x; 1x = mesa do
       tamanho da tela, sem zoom out além disso).
     - Arrastar o fundo vazio: pan.
     - Espaço: volta suavemente a 100%.
     A física continua em coordenadas de mesa: as bordas de batida são
     as da mesa, que é sempre do tamanho da janela.
     ------------------------------------------------------------------------ */
  const VISTA = { min: 1, max: 4, duracaoReset: 520 };
  let cancelarVista = null;
  let panMesa = null;

  function paraMesa(cx, cy) {
    return { x: (cx - vista.x) / vista.escala, y: (cy - vista.y) / vista.escala };
  }

  function pararVista() {
    if (cancelarVista) { cancelarVista(); cancelarVista = null; }
  }

  // A mesa sempre cobre a tela inteira: o pan para nas bordas dela
  function limitarVista() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    vista.x = limitar(vista.x, W - W * vista.escala, 0);
    vista.y = limitar(vista.y, H - H * vista.escala, 0);
  }

  function aplicarVista() {
    const neutra = vista.escala === 1 && vista.x === 0 && vista.y === 0;
    mesa.style.transform = neutra
      ? ""
      : `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala})`;
  }

  function resetVista(suave) {
    pararVista();
    const de = { escala: vista.escala, x: vista.x, y: vista.y };
    const fim = () => {
      cancelarVista = null;
      vista.escala = 1;
      vista.x = 0;
      vista.y = 0;
      aplicarVista();
    };
    if (!suave || movimentoReduzido() ||
        (de.escala === 1 && de.x === 0 && de.y === 0)) { fim(); return; }

    cancelarVista = tween(VISTA.duracaoReset, k => {
      vista.escala = de.escala + (1 - de.escala) * k;
      vista.x = de.x * (1 - k);
      vista.y = de.y * (1 - k);
      aplicarVista();
    }, fim);
  }

  canvas.addEventListener("wheel", e => {
    if (aberta) return;
    e.preventDefault();
    pararVista();
    const nova = limitar(vista.escala * fatorRoda(e), VISTA.min, VISTA.max);
    if (nova === vista.escala) return;
    // mantém sob o cursor o mesmo ponto da mesa
    const f = nova / vista.escala;
    vista.x = e.clientX - (e.clientX - vista.x) * f;
    vista.y = e.clientY - (e.clientY - vista.y) * f;
    vista.escala = nova;
    limitarVista();
    aplicarVista();
  }, { passive: false });

  // Pan: só quando o arrasto começa no fundo (as peças têm o próprio arrasto)
  canvas.addEventListener("pointerdown", e => {
    if (e.button !== 0 || aberta || e.target.closest(".piece")) return;
    e.preventDefault();
    pararVista();
    canvas.setPointerCapture(e.pointerId);
    panMesa = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: vista.x, y: vista.y };
    document.body.classList.add("is-panning");
  });

  canvas.addEventListener("pointermove", e => {
    if (!panMesa || e.pointerId !== panMesa.id) return;
    vista.x = panMesa.x + (e.clientX - panMesa.sx);
    vista.y = panMesa.y + (e.clientY - panMesa.sy);
    limitarVista();
    aplicarVista();
  });

  const fimPanMesa = e => {
    if (!panMesa || e.pointerId !== panMesa.id) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    panMesa = null;
    document.body.classList.remove("is-panning");
  };
  canvas.addEventListener("pointerup", fimPanMesa);
  canvas.addEventListener("pointercancel", fimPanMesa);

  /* ------------------------------------------------------------------------
     16. ZOOM, PAN E ROTAÇÃO NA VISUALIZAÇÃO EM DESTAQUE (#viewer)
     - Roda do mouse sobre o palco: zoom ancorado no cursor, a partir de 1x.
       Máximo por peça: (largura nativa ÷ largura exibida) × 1.5, entre 2x e 8x.
     - Arrastar a imagem (mãozinha):
         em 1x  → gira a peça em torno do centro, com suavização e embalo
                  (ao soltar rápido, ela continua girando e desacelera);
         com zoom → pan, para inspecionar detalhes.
       Um clique sem arrastar, em 1x, continua fechando o visualizador.
     - "↻ virar": gira 90° no sentido horário, até o próximo ângulo reto.
     - "▢ posição original" (aparece quando a peça foi girada, ampliada ou
       movida) e Espaço: voltam tudo ao normal.
     As duas ações ficam sempre no mesmo lugar, acima da peça mais alta.
     O transform da imagem (origem no centro) fica por cima do retângulo
     calculado em retanguloFinal(): translate → rotate → scale.
     ------------------------------------------------------------------------ */
  const ZV = {
    z: 1, tx: 0, ty: 0,
    r: 0,          // ângulo exibido (graus)
    alvoR: 0,      // ângulo para onde a rotação está indo
    vGiro: 0,      // embalo depois de soltar (graus/ms)
    gesto: null, ignorarClique: false, cancelar: null
  };
  const GIRO = {
    suavidade: 70,     // ms: quanto o ângulo "persegue" o dedo/cursor (menor = mais colado)
    atrito: 420,       // ms: duração do embalo depois de soltar
    velocidadeMax: 1.2 // graus/ms
  };
  const acoes = document.getElementById("viewer-acoes");
  const botaoReset = document.getElementById("viewer-reset");
  const botaoVirar = document.getElementById("viewer-virar");

  const normalizarAngulo = a => ((a % 360) + 540) % 360 - 180; // (-180, 180]
  const normalizarRad = a => Math.atan2(Math.sin(a), Math.cos(a));

  function zoomMaximo(r) {
    const nativa = V.img.naturalWidth;
    if (!nativa || !r.w) return 2;
    return limitar((nativa / r.w) * 1.5, 2, 8);
  }

  // A imagem pode andar até a sua borda encostar na borda do retângulo original
  function limitarPanZoom(r) {
    const lx = (r.w * (ZV.z - 1)) / 2;
    const ly = (r.h * (ZV.z - 1)) / 2;
    ZV.tx = limitar(ZV.tx, -lx, lx);
    ZV.ty = limitar(ZV.ty, -ly, ly);
  }

  const estaNeutro = () =>
    Math.abs(ZV.z - 1) < 0.001 && Math.abs(ZV.tx) < 0.5 &&
    Math.abs(ZV.ty) < 0.5 && Math.abs(normalizarAngulo(ZV.alvoR)) < 0.1 &&
    Math.abs(normalizarAngulo(ZV.r)) < 0.1;

  function aplicarZoomViewer() {
    const neutro = ZV.z === 1 && ZV.tx === 0 && ZV.ty === 0 && ZV.r === 0;
    V.img.style.transform = neutro
      ? ""
      : `translate(${ZV.tx}px, ${ZV.ty}px) rotate(${ZV.r}deg) scale(${ZV.z})`;
    // recorte no palco: a imagem girada/ampliada não invade a ficha
    V.stage.classList.toggle("is-zoomed", !neutro);
    atualizarBotaoReset();
  }

  // Posição fixa das ações: centro do palco, acima do topo da peça que fica
  // mais alta no visualizador. Calculada uma vez por abertura/redimensionamento.
  function posicionarBotaoReset() {
    const topo = Math.min(...pecas.map(p => retanguloFinal(p).y));
    const r = retanguloFinal(aberta || pecas[0]);
    acoes.style.left = r.x + r.w / 2 + "px"; // todas as peças são centralizadas
    acoes.style.top = Math.max(12, topo - 44) + "px";
  }

  function atualizarBotaoReset() {
    const grupo = !!aberta && !animando;
    acoes.classList.toggle("is-visible", grupo);
    botaoVirar.tabIndex = grupo ? 0 : -1;
    // "posição original": só quando há algo a desfazer
    const reset = grupo && !ZV.cancelar && !estaNeutro();
    botaoReset.classList.toggle("is-visible", reset);
    botaoReset.tabIndex = reset ? 0 : -1;
    botaoReset.setAttribute("aria-hidden", String(!reset));
  }

  /* Laço da rotação: o ângulo exibido persegue o ângulo-alvo com
     suavização exponencial; depois de soltar, o embalo empurra o alvo
     e vai sumindo pelo atrito. Para sozinho quando tudo assenta. */
  let rafGiro = 0;
  let ultimoGiro = 0;

  function acordarGiro() {
    if (rafGiro) return;
    ultimoGiro = performance.now();
    rafGiro = requestAnimationFrame(passoGiro);
  }

  function pararGiro() {
    cancelAnimationFrame(rafGiro);
    rafGiro = 0;
    ZV.vGiro = 0;
  }

  function passoGiro(t) {
    const dt = Math.min(32, Math.max(1, t - ultimoGiro));
    ultimoGiro = t;

    if (ZV.vGiro && !ZV.gesto) {
      ZV.alvoR += ZV.vGiro * dt;
      ZV.vGiro *= Math.exp(-dt / GIRO.atrito);
      if (Math.abs(ZV.vGiro) < 0.003) ZV.vGiro = 0;
    }

    ZV.r += (ZV.alvoR - ZV.r) * (1 - Math.exp(-dt / GIRO.suavidade));
    const assentou = Math.abs(ZV.alvoR - ZV.r) < 0.05 && !ZV.vGiro && !ZV.gesto;
    if (assentou) ZV.r = ZV.alvoR = normalizarAngulo(ZV.alvoR); // 360° = 0°
    aplicarZoomViewer();
    rafGiro = assentou ? 0 : requestAnimationFrame(passoGiro);
  }

  function resetZoomViewer(suave) {
    if (ZV.cancelar) { ZV.cancelar(); ZV.cancelar = null; }
    pararGiro();
    ZV.gesto = null;
    V.img.classList.remove("is-panning");
    ZV.r = normalizarAngulo(ZV.r); // volta pelo caminho mais curto
    ZV.alvoR = ZV.r;
    const de = { z: ZV.z, tx: ZV.tx, ty: ZV.ty, r: ZV.r };
    const fim = () => {
      ZV.cancelar = null;
      ZV.z = 1;
      ZV.tx = 0;
      ZV.ty = 0;
      ZV.r = ZV.alvoR = 0;
      aplicarZoomViewer();
    };
    if (!suave || movimentoReduzido() ||
        (de.z === 1 && de.tx === 0 && de.ty === 0 && de.r === 0)) { fim(); return; }

    ZV.cancelar = tween(420, k => {
      ZV.z = de.z + (1 - de.z) * k;
      ZV.tx = de.tx * (1 - k);
      ZV.ty = de.ty * (1 - k);
      ZV.r = ZV.alvoR = de.r * (1 - k);
      aplicarZoomViewer();
    }, fim);
    atualizarBotaoReset();
  }

  // Virar: 90° no sentido horário, até o próximo ângulo reto.
  // Cliques seguidos acumulam (cada um soma mais 90°).
  function virar() {
    if (!aberta || animando) return;
    if (ZV.cancelar) { ZV.cancelar(); ZV.cancelar = null; ZV.alvoR = ZV.r; }
    ZV.vGiro = 0;
    ZV.alvoR = Math.floor(ZV.alvoR / 90 + 1e-6) * 90 + 90;
    if (movimentoReduzido()) { ZV.r = ZV.alvoR; aplicarZoomViewer(); return; }
    acordarGiro();
  }

  botaoReset.addEventListener("click", e => {
    e.stopPropagation();
    resetZoomViewer(true);
    botaoVirar.focus({ preventScroll: true }); // o botão some; o foco vai para "virar"
  });
  botaoVirar.addEventListener("click", e => {
    e.stopPropagation();
    virar();
  });

  V.stage.addEventListener("wheel", e => {
    e.preventDefault();
    if (!aberta || animando) return;
    if (ZV.cancelar) { ZV.cancelar(); ZV.cancelar = null; ZV.alvoR = ZV.r; }

    const r = retanguloFinal(aberta);
    const novo = limitar(ZV.z * fatorRoda(e), 1, zoomMaximo(r));
    if (novo === ZV.z) return;

    // mantém sob o cursor o mesmo ponto da imagem (vale com a peça girada:
    // a rotação se cancela na conta)
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const f = novo / ZV.z;
    ZV.tx = e.clientX - cx - (e.clientX - cx - ZV.tx) * f;
    ZV.ty = e.clientY - cy - (e.clientY - cy - ZV.ty) * f;
    ZV.z = novo;
    limitarPanZoom(r);
    aplicarZoomViewer();
  }, { passive: false });

  V.img.addEventListener("pointerdown", e => {
    if (e.button !== 0 || animando || !aberta) return;
    e.preventDefault();
    if (ZV.cancelar) { ZV.cancelar(); ZV.cancelar = null; ZV.alvoR = ZV.r; }
    ZV.vGiro = 0; // "pega" a peça se ainda estiver girando
    V.img.setPointerCapture(e.pointerId);

    const r = retanguloFinal(aberta);
    const cx = r.x + r.w / 2 + ZV.tx; // centro da imagem na tela
    const cy = r.y + r.h / 2 + ZV.ty;
    const a = Math.atan2(e.clientY - cy, e.clientX - cx);
    ZV.gesto = {
      tipo: ZV.z > 1.001 ? "pan" : "girar",
      id: e.pointerId, sx: e.clientX, sy: e.clientY,
      tx: ZV.tx, ty: ZV.ty,
      cx, cy,
      r0: ZV.alvoR,   // gira a partir de onde a peça está indo
      aAnt: a,        // último ângulo do ponteiro (rad)
      giro: 0,        // giro acumulado (rad), sem saltos ao passar de 180°
      amostras: [{ t: performance.now(), r: ZV.alvoR }],
      moveu: false
    };
    V.img.classList.add("is-panning");
  });

  V.img.addEventListener("pointermove", e => {
    const g = ZV.gesto;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moveu && Math.hypot(dx, dy) <= 3) return;
    g.moveu = true;

    if (g.tipo === "pan") {
      ZV.tx = g.tx + dx;
      ZV.ty = g.ty + dy;
      limitarPanZoom(retanguloFinal(aberta));
      aplicarZoomViewer();
      return;
    }

    // Muito perto do centro o ângulo fica instável: ignora
    if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < 12) return;
    const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
    g.giro += normalizarRad(a - g.aAnt);
    g.aAnt = a;
    ZV.alvoR = g.r0 + (g.giro * 180) / Math.PI;

    const agora = performance.now();
    g.amostras.push({ t: agora, r: ZV.alvoR });
    while (g.amostras.length > 2 && agora - g.amostras[0].t > 100) g.amostras.shift();
    acordarGiro();
  });

  const fimGesto = e => {
    const g = ZV.gesto;
    if (!g || e.pointerId !== g.id) return;
    if (V.img.hasPointerCapture(e.pointerId)) V.img.releasePointerCapture(e.pointerId);

    // Embalo: velocidade angular dos últimos ~100 ms (zero se parou antes de soltar)
    if (g.tipo === "girar" && g.moveu) {
      const agora = performance.now();
      const a = g.amostras.filter(s => agora - s.t <= 100);
      if (a.length >= 2 && agora - a[a.length - 1].t < 50) {
        const dt = Math.max(a[a.length - 1].t - a[0].t, 8);
        ZV.vGiro = limitar((a[a.length - 1].r - a[0].r) / dt, -GIRO.velocidadeMax, GIRO.velocidadeMax);
      }
    }

    // arrastar (girar ou mover) nunca fecha o modal; clique simples em 1x fecha
    if (g.moveu || g.tipo === "pan") {
      ZV.ignorarClique = true;
      setTimeout(() => { ZV.ignorarClique = false; }, 0);
    }
    ZV.gesto = null;
    V.img.classList.remove("is-panning");
    acordarGiro();
  };
  V.img.addEventListener("pointerup", fimGesto);
  V.img.addEventListener("pointercancel", fimGesto);

  /* ------------------------------------------------------------------------
     17. ESPAÇO: RESET DO ZOOM
     Capturado na janela antes de qualquer outro elemento: não aciona o
     último botão clicado, não rola a página nem a ficha técnica.
     ------------------------------------------------------------------------ */
  const ehEspaco = e => e.code === "Space" || e.key === " ";
  const ehCampoDeTexto = el =>
    el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  window.addEventListener("keydown", e => {
    if (!ehEspaco(e) || ehCampoDeTexto(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (aberta) { if (!animando) resetZoomViewer(true); }
    else resetVista(true);
  }, true);

  // Em alguns navegadores o botão é acionado no keyup do Espaço
  window.addEventListener("keyup", e => {
    if (ehEspaco(e) && !ehCampoDeTexto(e.target)) e.preventDefault();
  }, true);

  /* ------------------------------------------------------------------------
     INICIALIZAÇÃO
     ------------------------------------------------------------------------ */
  // As peças só vão para a mesa depois que os scans carregam (ou caem no
  // placeholder): assim a orientação e o tamanho já estão certos.
  let pronto = false;
  criarPecas();
  atualizarControles();
  Promise.all(pecas.map(carregarImagem)).then(() => {
    dimensionar();
    espalharInicial();
    pronto = true;
  });
})();
