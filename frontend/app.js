/**
 * Substitua pelo endereço exibido após:
 *   npx hardhat run scripts/deploy.js --network localhost
 *
 * Feature flag (query): `?showHardhatNetwork=1` (ou `true` / `yes`) exibe a seção do botão
 * “Adicionar ou mudar para Hardhat local” (EIP-3326 / EIP-3085). Sem o parâmetro, fica oculta.
 */
const CONTRACT_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

/** Deve coincidir com hardhat.config.js → networks.localhost.chainId */
const HARDHAT_LOCAL_CHAIN_ID = 31337;

/** MetaMask / provedores às vezes devolvem `number`, `bigint`, hex ou BigNumber do ethers. */
function normalizeChainId(chainId) {
  if (chainId == null) return NaN;
  if (typeof chainId === 'number' && Number.isFinite(chainId)) return chainId;
  if (typeof chainId === 'bigint') return Number(chainId);
  if (typeof chainId === 'string') {
    const s = chainId.trim();
    if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
  }
  if (typeof chainId.toNumber === 'function') return chainId.toNumber();
  const n = Number(chainId);
  return Number.isFinite(n) ? n : NaN;
}

function isQueryFlagEnabled(paramName) {
  const raw = new URLSearchParams(window.location.search).get(paramName);
  if (raw == null || raw === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/** MetaMask + outras carteiras: usa `providers[]` quando existir (EIP-5749). */
function getInjectableProvider() {
  const { ethereum } = window;
  if (!ethereum) return null;
  const list = ethereum.providers;
  if (Array.isArray(list) && list.length > 0) {
    return list.find((p) => p.isMetaMask) ?? list[0];
  }
  return ethereum;
}

const ABI = [
  {
    inputs: [],
    name: 'getMessage',
    outputs: [
      {
        internalType: 'string',
        name: '',
        type: 'string',
      },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [],
    name: 'get',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'x',
        type: 'uint256',
      },
    ],
    name: 'set',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

let provider;
let signer;
let contract;

function setMessageUi(text) {
  document.getElementById('message').innerText = text;
}

function setWalletUi(text) {
  document.getElementById('wallet').innerText = text;
}

function setGetMessageEnabled(on) {
  document.getElementById('btn-message').disabled = !on;
}

/** Mensagem para o aluno/usuário (códigos EIP-1193 / MetaMask). */
function friendlyWalletError(err) {
  const code = err?.code;
  const n = Number(code);
  const msg = (err?.message || '').toLowerCase();

  // https://eips.ethereum.org/EIPS/eip-1193#provider-errors
  if (n === 4001) {
    return (
      'A conexão foi recusada ou você fechou o aviso da MetaMask.\n\n' +
      'Abra a extensão, crie ou importe uma carteira se ainda não tiver, e clique em Conectar de novo — ' +
      'quando a MetaMask pedir permissão para este site, escolha Conectar.'
    );
  }
  if (n === 4100) {
    return 'A carteira não autorizou esta ação. Desbloqueie a MetaMask e tente novamente.';
  }
  if (code === -32002 || msg.includes('already pending')) {
    return 'Já existe um pedido pendente na MetaMask. Abra a extensão, aceite ou cancele, e tente de novo.';
  }

  const raw = err?.message || err?.reason;
  if (raw) {
    return `Não foi possível conectar. Detalhe: ${raw}`;
  }
  return 'Não foi possível conectar à carteira. Tente novamente.';
}

/** Erros de leitura de contrato (ethers v5 CALL_EXCEPTION, etc.). */
function friendlyCallError(err) {
  const code = err?.code;
  const data = err?.data;
  const emptyRevert = code === 'CALL_EXCEPTION' && (!data || data === '0x');
  if (emptyRevert) {
    return (
      'A leitura de getMessage() falhou.\n\n' +
      'Quem costuma causar isso (revert sem dados):\n' +
      '• MetaMask em outra rede — selecione Hardhat local (chain 31337, RPC 127.0.0.1:8545).\n' +
      '• Nó parado — rode `npm run chain` antes do deploy e de usar o app.\n' +
      '• Estado zerado — se você reiniciou `hardhat node`, faça `npm run deploy:local` de novo e ' +
      'copie o novo endereço para CONTRACT_ADDRESS em app.js.\n' +
      '• Endereço errado — CONTRACT_ADDRESS precisa ser o que o deploy imprimiu na mesma sessão de nó.'
    );
  }
  if (code === 'CALL_EXCEPTION') {
    return `Chamada ao contrato falhou: ${err.reason || err.message || 'CALL_EXCEPTION'}`;
  }
  if (code === 'NETWORK_ERROR' || (err?.message || '').includes('network')) {
    return 'Erro de rede. Confira se o nó Hardhat está rodando e se a MetaMask aponta para 127.0.0.1:8545.';
  }
  return err?.message || err?.reason || String(err);
}

/** Rede local do `npx hardhat node` — alinhada ao hardhat.config.js (chainId 31337). */
const HARDHAT_LOCAL_CHAIN = {
  chainId: '0x7a69',
  chainName: 'Hardhat Local',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['http://127.0.0.1:8545'],
};

function setNetworkStatusUi(text) {
  const el = document.getElementById('network-status');
  if (el) el.innerText = text;
}

/**
 * EIP-3085 / EIP-3326: pedir à carteira para mudar ou cadastrar a rede (fluxo “pelo site”).
 * Não substituir adicionar rede manualmente nas configurações — é o outro jeito de demonstrar.
 */
async function addHardhatNetworkViaSite() {
  const ethereum = getInjectableProvider();
  if (!ethereum || typeof ethereum.request !== 'function') {
    alert(
      'Instale a MetaMask (ou carteira compatível) e abra esta página em um navegador com a extensão.'
    );
    return;
  }

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: HARDHAT_LOCAL_CHAIN.chainId }],
    });
    setNetworkStatusUi('Rede Hardhat local (chain 31337) selecionada na MetaMask.');
  } catch (err) {
    const code = err?.code;
    const isNotAdded = code === 4902 || code === '4902';
    if (isNotAdded) {
      try {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [HARDHAT_LOCAL_CHAIN],
        });
        setNetworkStatusUi(
          'Rede cadastrada pela MetaMask (pedido deste site). Confira o nome e o RPC; depois use Conectar carteira.'
        );
      } catch (addErr) {
        console.error(addErr);
        const label = friendlyWalletError(addErr);
        setNetworkStatusUi(label.split('\n\n')[0]);
        alert(label);
      }
      return;
    }
    console.error(err);
    const label = friendlyWalletError(err);
    setNetworkStatusUi(label.split('\n\n')[0]);
    alert(label);
  }
}

async function connectWallet() {
  if (typeof ethers === 'undefined') {
    const msg =
      'ethers.js não carregou. Confira na aba Network se vendor/ethers.umd.min.js retorna 200 (arquivo local na pasta frontend/vendor).';
    console.error(msg);
    setWalletUi(msg);
    alert(msg);
    return;
  }

  const ethereum = getInjectableProvider();
  if (!ethereum || typeof ethereum.request !== 'function') {
    alert(
      'Instale a MetaMask (ou carteira compatível) e abra esta página em um navegador com a extensão.'
    );
    return;
  }

  try {
    await ethereum.request({ method: 'eth_requestAccounts' });
    provider = new ethers.providers.Web3Provider(ethereum);
    signer = provider.getSigner();

    const address = await signer.getAddress();
    const { chainId } = await provider.getNetwork();
    const chainIdNum = normalizeChainId(chainId);
    const chainOk = chainIdNum === HARDHAT_LOCAL_CHAIN_ID;
    setWalletUi(
      `Connected: ${address}\n` +
        `Chain ID: ${chainIdNum}${
          chainOk
            ? ' (Hardhat local)'
            : ` — esperado ${HARDHAT_LOCAL_CHAIN_ID} para o contrato desta aula`
        }`
    );

    if (CONTRACT_ADDRESS === 'SEU_ENDERECO_AQUI' || !ethers.utils.isAddress(CONTRACT_ADDRESS)) {
      setGetMessageEnabled(false);
      setMessageUi('Defina CONTRACT_ADDRESS em app.js após o deploy.');
      alert('Configure CONTRACT_ADDRESS em frontend/app.js com o endereço do contrato deployado.');
      return;
    }

    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    const bytecode = await provider.getCode(CONTRACT_ADDRESS);
    if (!bytecode || bytecode === '0x') {
      setGetMessageEnabled(false);
      const wrongChain = chainIdNum !== HARDHAT_LOCAL_CHAIN_ID;
      setMessageUi(
        wrongChain
          ? `Nesta rede (chain ${chainIdNum}) não há contrato em ${CONTRACT_ADDRESS}. ` +
              'Na MetaMask, mude para Hardhat (31337) com RPC http://127.0.0.1:8545 — o endereço do deploy só vale nesse nó.'
          : `Chain ${chainIdNum} certo, mas sem bytecode em ${CONTRACT_ADDRESS}. ` +
              'Reinicie `npm run chain`, rode `npm run deploy:local` e copie o endereço novo para CONTRACT_ADDRESS.'
      );
      return;
    }

    setGetMessageEnabled(true);
    setMessageUi('');
  } catch (err) {
    console.error(err);
    const label = friendlyWalletError(err);
    setWalletUi(label.split('\n\n')[0]);
    alert(label);
  }
}

async function getMessage() {
  if (!contract) {
    alert('Conecte a carteira primeiro!');
    return;
  }

  try {
    const message = await contract.getMessage();
    setMessageUi(message);
  } catch (err) {
    console.error(err);
    const label = friendlyCallError(err);
    setMessageUi(label.split('\n\n')[0]);
    alert(label);
  }
}

document.getElementById('btn-connect').addEventListener('click', connectWallet);
document.getElementById('btn-add-network').addEventListener('click', addHardhatNetworkViaSite);
document.getElementById('btn-message').addEventListener('click', getMessage);

if (isQueryFlagEnabled('showHardhatNetwork')) {
  document.getElementById('section-site-network')?.removeAttribute('hidden');
}
