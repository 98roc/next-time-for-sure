const form = document.getElementById('settings');
const message = document.getElementById('message');
const save = document.getElementById('save');
const webUrl = document.getElementById('webUrl');
const updateUrl = document.getElementById('updateUrl');
const checkOnStartup = document.getElementById('checkOnStartup');

async function initialize() {
  try {
    const data = await window.desktopSettings.read();
    webUrl.value = data.config.webUrl;
    updateUrl.value = data.config.updateUrl;
    checkOnStartup.checked = data.config.checkOnStartup;
    document.getElementById('version').textContent = `版本 ${data.version}`;
    message.textContent = data.error;
  } catch {
    message.textContent = '无法读取客户端设置，请关闭窗口后重试。';
    save.disabled = true;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  save.disabled = true;
  message.textContent = '';
  try {
    const result = await window.desktopSettings.save({ webUrl: webUrl.value, updateUrl: updateUrl.value, checkOnStartup: checkOnStartup.checked });
    message.textContent = result.ok ? '已保存，正在重启…' : result.error;
    if (!result.ok) save.disabled = false;
  } catch {
    message.textContent = '保存失败，请重试。';
    save.disabled = false;
  }
});

void initialize();
