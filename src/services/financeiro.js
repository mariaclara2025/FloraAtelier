const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function arredondar2(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function formatarMoedaBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * Calcula preço de venda a partir do custo total e margem (%) sobre o preço de venda.
 * Ex.: custo = R$ 60,00 e margem = 40% -> 60 / (1 - 0.40) = R$ 100,00
 * (lucro de R$ 40,00, que corresponde a 40% do preço final).
 */
function calcularPrecoPorMargem(custoTotal, margemPercentual) {
  const custo = Math.max(0, Number(custoTotal) || 0);
  const margem = Math.min(99, Math.max(0, Number(margemPercentual) || 0));
  if (margem === 0) return arredondar2(custo);
  return arredondar2(custo / (1 - margem / 100));
}

/**
 * Busca ou cria a configuração financeira padrão do ateliê (id = 1).
 */
async function obterConfiguracao(tx = prisma) {
  let config = await tx.configuracaoFinanceira.findUnique({
    where: { id: 1 }
  });

  if (!config) {
    config = await tx.configuracaoFinanceira.create({
      data: {
        id: 1,
        valorHora: 25.0,
        margemPadrao: 40.0
      }
    });
  }

  return config;
}

/**
 * Atualiza valorHora e/ou margemPadrao e recalcula todos os produtos
 * que não possuem preço manual travado.
 */
async function atualizarConfiguracaoERecalcular({ valorHora, margemPadrao }) {
  return prisma.$transaction(async (tx) => {
    const atual = await obterConfiguracao(tx);

    const configAtualizada = await tx.configuracaoFinanceira.update({
      where: { id: 1 },
      data: {
        valorHora:
          valorHora !== undefined && valorHora !== ''
            ? Math.max(0, Number(valorHora))
            : atual.valorHora,
        margemPadrao:
          margemPadrao !== undefined && margemPadrao !== ''
            ? Math.min(99, Math.max(0, Number(margemPadrao)))
            : atual.margemPadrao
      }
    });

    const flores = await tx.flor.findMany({ select: { id: true } });
    for (const f of flores) {
      await recalcularFlorTx(tx, f.id);
    }

    const produtos = await tx.produto.findMany({ select: { id: true } });
    for (const p of produtos) {
      await recalcularProdutoTx(tx, p.id);
    }

    return configAtualizada;
  });
}

/**
 * 1) Salva ou atualiza um Insumo, calcula o preço unitário e dispara a cascata
 * para Flores e Produtos (buquês) que dependem dele.
 */
async function salvarInsumoERecalcular({
  id,
  nome,
  qtdTotal,
  qtdDisponivel,
  custoTotal
}) {
  const qtd = Number(qtdTotal);
  const custo = Number(custoTotal);

  if (!nome || !String(nome).trim()) {
    throw new Error('Informe o nome do insumo/material.');
  }
  if (!Number.isFinite(qtd) || qtd <= 0) {
    throw new Error('A quantidade total do insumo deve ser maior que zero.');
  }
  if (!Number.isFinite(custo) || custo < 0) {
    throw new Error('O custo total do insumo não pode ser negativo.');
  }

  const precoUnitario = arredondar2(custo / qtd);
  const custoArredondado = arredondar2(custo);
  const disponivel =
    qtdDisponivel !== undefined && qtdDisponivel !== '' && qtdDisponivel !== null
      ? arredondar2(Number(qtdDisponivel))
      : arredondar2(qtd);

  return prisma.$transaction(async (tx) => {
    const insumo = id
      ? await tx.insumo.update({
          where: { id: Number(id) },
          data: {
            nome: String(nome).trim(),
            qtdTotal: qtd,
            qtdDisponivel: disponivel,
            custoTotal: custoArredondado,
            precoUnitario
          }
        })
      : await tx.insumo.create({
          data: {
            nome: String(nome).trim(),
            qtdTotal: qtd,
            qtdDisponivel: disponivel,
            custoTotal: custoArredondado,
            precoUnitario
          }
        });

    // Flores que usam esse insumo
    const ligacoesFlores = await tx.florInsumo.findMany({
      where: { insumoId: insumo.id },
      select: { florId: true }
    });
    const florIds = [...new Set(ligacoesFlores.map((f) => f.florId))];

    for (const florId of florIds) {
      await recalcularFlorTx(tx, florId);
    }

    // Buquês/produtos que usam o insumo diretamente OU usam alguma flor afetada
    const ligacoesProdInsumo = await tx.produtoInsumo.findMany({
      where: { insumoId: insumo.id },
      select: { produtoId: true }
    });

    const ligacoesProdFlor =
      florIds.length > 0
        ? await tx.produtoFlor.findMany({
            where: { florId: { in: florIds } },
            select: { produtoId: true }
          })
        : [];

    const produtoIds = [
      ...new Set([
        ...ligacoesProdInsumo.map((p) => p.produtoId),
        ...ligacoesProdFlor.map((p) => p.produtoId)
      ])
    ];

    for (const produtoId of produtoIds) {
      await recalcularProdutoTx(tx, produtoId);
    }

    return insumo;
  });
}

/**
 * 2) Recalcula uma Flor com base nos seus FlorInsumo e tempoConfeccaoMin.
 */
async function recalcularFlorTx(tx, florId) {
  const config = await obterConfiguracao(tx);

  const flor = await tx.flor.findUnique({
    where: { id: Number(florId) },
    include: {
      insumos: {
        include: { insumo: true }
      }
    }
  });

  if (!flor) return null;

  let custoMateriais = 0;
  for (const item of flor.insumos) {
    const precoUnit =
      item.insumo.precoUnitario ??
      (item.insumo.qtdTotal > 0
        ? item.insumo.custoTotal / item.insumo.qtdTotal
        : 0);

    custoMateriais += Number(precoUnit) * Number(item.quantidade || 0);
  }

  const horas = (Number(flor.tempoConfeccaoMin) || 0) / 60;
  const custoMaoDeObra = horas * Number(config.valorHora || 0);
  const custoTotal = custoMateriais + custoMaoDeObra;

  return tx.flor.update({
    where: { id: flor.id },
    data: {
      custoMateriais: arredondar2(custoMateriais),
      custoMaoDeObra: arredondar2(custoMaoDeObra),
      custoTotal: arredondar2(custoTotal)
    }
  });
}

/**
 * Salva uma Flor e sua receita de insumos (ex.: hastes, arame, fita floral, cola quente),
 * recalcula a flor e dispara a cascata nos buquês que usam essa flor.
 */
async function salvarFlorComReceita({
  id,
  nome,
  tempoConfeccaoMin = 0,
  itensInsumos = []
}) {
  if (!nome || !String(nome).trim()) {
    throw new Error('Informe o nome da flor.');
  }

  return prisma.$transaction(async (tx) => {
    const tempoMin = Math.max(0, Number(tempoConfeccaoMin) || 0);

    const flor = id
      ? await tx.flor.update({
          where: { id: Number(id) },
          data: {
            nome: String(nome).trim(),
            tempoConfeccaoMin: tempoMin
          }
        })
      : await tx.flor.create({
          data: {
            nome: String(nome).trim(),
            tempoConfeccaoMin: tempoMin
          }
        });

    await tx.florInsumo.deleteMany({ where: { florId: flor.id } });

    const itensValidos = (Array.isArray(itensInsumos) ? itensInsumos : [])
      .map((i) => ({
        insumoId: Number(i.insumoId),
        quantidade: Number(i.quantidade)
      }))
      .filter((i) => i.insumoId > 0 && Number.isFinite(i.quantidade) && i.quantidade > 0);

    if (itensValidos.length > 0) {
      await tx.florInsumo.createMany({
        data: itensValidos.map((i) => ({
          florId: flor.id,
          insumoId: i.insumoId,
          quantidade: i.quantidade
        }))
      });
    }

    const florAtualizada = await recalcularFlorTx(tx, flor.id);

    const ligacoesProdutos = await tx.produtoFlor.findMany({
      where: { florId: flor.id },
      select: { produtoId: true }
    });
    const produtoIds = [...new Set(ligacoesProdutos.map((p) => p.produtoId))];

    for (const produtoId of produtoIds) {
      await recalcularProdutoTx(tx, produtoId);
    }

    return florAtualizada;
  });
}

/**
 * 3) Recalcula um Produto (buquê) somando:
 * - flores (ProdutoFlor * flor.custoTotal)
 * - insumos diretos (ProdutoInsumo * insumo.precoUnitario, ex.: embrulho coreano, laço)
 * - mão de obra de montagem (tempoMontagemMin / 60 * valorHora)
 * E atualiza o preço automaticamente caso precoManual seja false.
 */
async function recalcularProdutoTx(tx, produtoId) {
  const config = await obterConfiguracao(tx);

  const produto = await tx.produto.findUnique({
    where: { id: Number(produtoId) },
    include: {
      flores: {
        include: { flor: true }
      },
      insumos: {
        include: { insumo: true }
      }
    }
  });

  if (!produto) return null;

  let custoFlores = 0;
  for (const pf of produto.flores) {
    custoFlores += (Number(pf.flor.custoTotal) || 0) * Number(pf.quantidade || 0);
  }

  let custoExtras = 0;
  for (const pi of produto.insumos) {
    const precoUnit =
      pi.insumo.precoUnitario ??
      (pi.insumo.qtdTotal > 0
        ? pi.insumo.custoTotal / pi.insumo.qtdTotal
        : 0);

    custoExtras += Number(precoUnit) * Number(pi.quantidade || 0);
  }

  const horasMontagem = (Number(produto.tempoMontagemMin) || 0) / 60;
  const custoMontagem = horasMontagem * Number(config.valorHora || 0);

  const custoProducao = arredondar2(custoFlores + custoExtras + custoMontagem);
  const margem =
    produto.margemLucro !== undefined && produto.margemLucro !== null && produto.margemLucro > 0
      ? Number(produto.margemLucro)
      : Number(config.margemPadrao);

  const precoAutomatico = calcularPrecoPorMargem(custoProducao, margem);

  return tx.produto.update({
    where: { id: produto.id },
    data: {
      custoProducao,
      margemLucro: arredondar2(margem),
      preco: produto.precoManual ? arredondar2(produto.preco) : precoAutomatico
    }
  });
}

/**
 * Salva ou atualiza um buquê/produto com suas flores, insumos diretos (ex.: embrulho coreano),
 * tempo de montagem e margem de lucro, calculando tudo automaticamente.
 */
async function salvarBuquePrecificado({
  id,
  nome,
  descricao = '',
  tipo = 'Buquê Completo',
  imagem = null,
  tamanho = null,
  corPrincipal = null,
  tempoMontagemMin = 0,
  margemLucro,
  precoManual = false,
  precoInformado,
  itensFlores = [],
  itensInsumos = []
}) {
  if (!nome || !String(nome).trim()) {
    throw new Error('Informe o nome do buquê/produto.');
  }

  return prisma.$transaction(async (tx) => {
    const config = await obterConfiguracao(tx);
    const usarManual = Boolean(precoManual);

    const margem =
      margemLucro !== undefined && margemLucro !== '' && margemLucro !== null
        ? Math.min(99, Math.max(0, Number(margemLucro)))
        : Number(config.margemPadrao);

    const dadosBase = {
      nome: String(nome).trim(),
      descricao: descricao || null,
      tipo: tipo || 'Buquê Completo',
      imagem: imagem || null,
      tamanho: tamanho || null,
      corPrincipal: corPrincipal || null,
      tempoMontagemMin: Math.max(0, Number(tempoMontagemMin) || 0),
      margemLucro: arredondar2(margem),
      precoManual: usarManual,
      ...(usarManual && precoInformado !== undefined && precoInformado !== ''
        ? { preco: arredondar2(Number(precoInformado)) }
        : {})
    };

    const produto = id
      ? await tx.produto.update({
          where: { id: Number(id) },
          data: dadosBase
        })
      : await tx.produto.create({
          data: {
            ...dadosBase,
            preco: usarManual && precoInformado ? arredondar2(Number(precoInformado)) : 0
          }
        });

    await tx.produtoFlor.deleteMany({ where: { produtoId: produto.id } });
    await tx.produtoInsumo.deleteMany({ where: { produtoId: produto.id } });

    const floresValidas = (Array.isArray(itensFlores) ? itensFlores : [])
      .map((f) => ({
        florId: Number(f.florId),
        quantidade: parseInt(f.quantidade, 10)
      }))
      .filter((f) => f.florId > 0 && Number.isInteger(f.quantidade) && f.quantidade > 0);

    if (floresValidas.length > 0) {
      await tx.produtoFlor.createMany({
        data: floresValidas.map((f) => ({
          produtoId: produto.id,
          florId: f.florId,
          quantidade: f.quantidade
        }))
      });
    }

    const insumosValidos = (Array.isArray(itensInsumos) ? itensInsumos : [])
      .map((i) => ({
        insumoId: Number(i.insumoId),
        quantidade: Number(i.quantidade)
      }))
      .filter((i) => i.insumoId > 0 && Number.isFinite(i.quantidade) && i.quantidade > 0);

    if (insumosValidos.length > 0) {
      await tx.produtoInsumo.createMany({
        data: insumosValidos.map((i) => ({
          produtoId: produto.id,
          insumoId: i.insumoId,
          quantidade: i.quantidade
        }))
      });
    }

    return recalcularProdutoTx(tx, produto.id);
  });
}

/**
 * 4) Calcula intervalo de datas para relatório semanal ou mensal.
 * - tipo: 'semanal' (últimos 7 dias corridos até agora) ou 'mensal' (mês/ano informado ou mês atual)
 */
function resolverPeriodoRelatorio({ tipo = 'semanal', ano, mes, dataReferencia } = {}) {
  const ref = dataReferencia ? new Date(dataReferencia) : new Date();

  if (tipo === 'mensal') {
    const anoAlvo = ano ? Number(ano) : ref.getFullYear();
    const mesAlvo = mes ? Number(mes) - 1 : ref.getMonth(); // 0-11
    const inicio = new Date(anoAlvo, mesAlvo, 1, 0, 0, 0, 0);
    const fim = new Date(anoAlvo, mesAlvo + 1, 0, 23, 59, 59, 999);
    return { tipo: 'mensal', inicio, fim };
  }

  // Semanal padrão: últimos 7 dias (incluindo o dia atual até o fim do dia)
  const fim = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
  const inicio = new Date(fim);
  inicio.setDate(fim.getDate() - 6);
  inicio.setHours(0, 0, 0, 0);

  return { tipo: 'semanal', inicio, fim };
}

/**
 * 5) Consolida faturamento, custo dos pedidos, despesas extras (model Custo),
 * lucro líquido, margem líquida e ranking de itens vendidos no período.
 */
async function gerarResumoFinanceiro({ tipo = 'semanal', ano, mes, dataInicio, dataFim } = {}) {
  const periodo =
    dataInicio && dataFim
      ? { tipo, inicio: new Date(dataInicio), fim: new Date(dataFim) }
      : resolverPeriodoRelatorio({ tipo, ano, mes });

  const [pedidos, despesas] = await Promise.all([
    prisma.pedido.findMany({
      where: {
        data: { gte: periodo.inicio, lte: periodo.fim },
        status: { not: 'Cancelado' }
      },
      include: {
        cliente: {
          select: { id: true, nome: true, email: true }
        },
        itens: {
          include: {
            produto: {
              select: { id: true, nome: true, tipo: true }
            }
          }
        }
      },
      orderBy: { data: 'desc' }
    }),
    prisma.custo.findMany({
      where: {
        data: { gte: periodo.inicio, lte: periodo.fim }
      },
      orderBy: { data: 'desc' }
    })
  ]);

  let faturamentoBruto = 0;
  let custoProducaoPedidos = 0;
  const mapaItensVendidos = new Map();

  for (const p of pedidos) {
    faturamentoBruto += Number(p.total) || 0;
    custoProducaoPedidos += Number(p.custoTotal) || 0;

    for (const item of p.itens) {
      const chave = item.produtoId;
      const atual = mapaItensVendidos.get(chave) || {
        produtoId: item.produtoId,
        nome: item.produto ? item.produto.nome : `Produto #${item.produtoId}`,
        tipo: item.produto ? item.produto.tipo : '-',
        quantidadeVendida: 0,
        receitaTotal: 0,
        custoTotal: 0
      };

      const qtd = Number(item.quantidade) || 0;
      const receitaItem = (Number(item.precoUnitario) || 0) * qtd;
      const custoItem = (Number(item.custoUnitario) || 0) * qtd;

      atual.quantidadeVendida += qtd;
      atual.receitaTotal = arredondar2(atual.receitaTotal + receitaItem);
      atual.custoTotal = arredondar2(atual.custoTotal + custoItem);
      mapaItensVendidos.set(chave, atual);
    }
  }

  let outrasDespesas = 0;
  const despesasPorCategoria = {};
  for (const c of despesas) {
    const val = Number(c.valor) || 0;
    outrasDespesas += val;
    const cat = c.categoria || 'Operacional';
    despesasPorCategoria[cat] = arredondar2((despesasPorCategoria[cat] || 0) + val);
  }

  const faturamentoArred = arredondar2(faturamentoBruto);
  const custoProdArred = arredondar2(custoProducaoPedidos);
  const despesasArred = arredondar2(outrasDespesas);
  const lucroBrutoPedidos = arredondar2(faturamentoArred - custoProdArred);
  const lucroLiquido = arredondar2(faturamentoArred - custoProdArred - despesasArred);
  const margemLiquidaPct =
    faturamentoArred > 0 ? arredondar2((lucroLiquido / faturamentoArred) * 100) : 0;

  const itensMaisVendidos = [...mapaItensVendidos.values()].sort(
    (a, b) => b.quantidadeVendida - a.quantidadeVendida
  );

  return {
    tipo: periodo.tipo,
    periodo: {
      inicio: periodo.inicio,
      fim: periodo.fim
    },
    quantidadePedidos: pedidos.length,
    faturamentoBruto: faturamentoArred,
    custoProducaoPedidos: custoProdArred,
    lucroBrutoPedidos,
    outrasDespesas: despesasArred,
    despesasPorCategoria,
    lucroLiquido,
    margemLiquidaPct,
    itensMaisVendidos,
    pedidos,
    despesas
  };
}

module.exports = {
  arredondar2,
  formatarMoedaBR,
  calcularPrecoPorMargem,
  obterConfiguracao,
  atualizarConfiguracaoERecalcular,
  salvarInsumoERecalcular,
  recalcularFlorTx,
  salvarFlorComReceita,
  recalcularProdutoTx,
  salvarBuquePrecificado,
  resolverPeriodoRelatorio,
  gerarResumoFinanceiro
};