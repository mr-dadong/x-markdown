// 官网与客户端共用同一份发布清单，避免重复维护版本号和下载地址。
(function () {
  // 通过同源 Pages Function 获取版本清单，避免浏览器被 CNB 的跨域策略拦截。
  // 小清单只含最新版，体积恒定；全量历史仅在 changelog 页或指定历史版本下载时才拉取。
  var manifestUrl = '/api/version';
  var historyUrl = '/api/history';

  function validateManifest(manifest) {
    if (!manifest || typeof manifest.latest !== 'string' || !Array.isArray(manifest.releases)) {
      throw new Error('版本清单格式不正确');
    }

    var latestRelease = manifest.releases.find(function (release) {
      return release && release.version === manifest.latest;
    });
    if (!latestRelease || !latestRelease.downloads || !Array.isArray(latestRelease.content)) {
      throw new Error('最新版发布信息不完整');
    }
    return latestRelease;
  }

  function selectDownloadRelease(manifest, latestRelease) {
    if (!document.querySelector('[data-platform]')) return latestRelease;

    var requestedVersion = new URLSearchParams(window.location.search).get('version');
    if (!requestedVersion) return latestRelease;

    var requestedRelease = manifest.releases.find(function (release) {
      return release && release.version === requestedVersion;
    });
    if (!requestedRelease) throw new Error('找不到 v' + requestedVersion + ' 的发布信息');
    return requestedRelease;
  }

  function setLatestVersion(version) {
    document.querySelectorAll('[data-latest-version]').forEach(function (element) {
      element.textContent = 'v' + version;
    });
  }

  function createUnavailableButton(text) {
    var button = document.createElement('span');
    button.className = 'btn btn--ghost btn--block';
    button.textContent = text;
    return button;
  }

  function renderUnavailablePlatform(card) {
    var status = card.querySelector('[data-platform-status]');
    var version = card.querySelector('[data-platform-version]');
    var requirements = card.querySelector('[data-platform-requirements]');
    var actions = card.querySelector('[data-platform-actions]');

    // 发布清单没有配置当前平台时，只禁用该平台，避免影响其他平台正常展示。
    status.textContent = '暂未提供';
    status.classList.add('platform-card-label-muted');
    card.classList.remove('platform-card-primary');
    version.textContent = '当前版本暂未提供';
    requirements.textContent = '尚未提供此平台版本';
    actions.replaceChildren(createUnavailableButton('暂未提供'));
  }

  function getDownloadButtonText(platformName, arch, version) {
    // macOS 用户通常更熟悉芯片名称，避免直接展示较生硬的 arm64 架构术语。
    if (platformName === 'macos') {
      return arch === 'arm64'
        ? '下载 XMD ' + version + ' · Apple 芯片'
        : '下载 XMD ' + version + ' · Intel 芯片';
    }

    // Windows 与 Linux 在按钮中同时展示版本和架构，用户点击前即可完成确认。
    return '下载 XMD ' + version + ' · ' + arch.toUpperCase();
  }

  function renderDownloadPage(release) {
    var platformCards = document.querySelectorAll('[data-platform]');
    if (!platformCards.length) return;

    platformCards.forEach(function (card) {
      var platformName = card.getAttribute('data-platform');
      var platform = release.downloads[platformName];
      if (!platform || !Array.isArray(platform.packages)) {
        renderUnavailablePlatform(card);
        return;
      }

      var status = card.querySelector('[data-platform-status]');
      var version = card.querySelector('[data-platform-version]');
      var requirements = card.querySelector('[data-platform-requirements]');
      var actions = card.querySelector('[data-platform-actions]');
      var publishedPackages = platform.packages.filter(function (item) {
        return platform.available && item && typeof item.url === 'string' && item.url;
      });

      status.textContent = publishedPackages.length ? '当前可用' : '计划支持';
      status.classList.toggle('platform-card-label-muted', !publishedPackages.length);
      card.classList.toggle('platform-card-primary', publishedPackages.length > 0);
      version.textContent = publishedPackages.length
        ? 'XMD ' + release.version
        : '即将提供';
      requirements.textContent = publishedPackages.length
        ? platform.requirements + ' · ' + publishedPackages.map(function (item) { return item.arch.toUpperCase(); }).join(' / ')
        : platform.requirements;
      actions.replaceChildren();

      if (!publishedPackages.length) {
        actions.appendChild(createUnavailableButton('正在准备'));
        return;
      }

      publishedPackages.forEach(function (item) {
        var link = document.createElement('a');
        link.className = 'btn btn--primary btn--block';
        link.href = item.url;
        // 按钮明确展示版本与适用架构，安装包格式由下载文件名体现。
        link.textContent = getDownloadButtonText(platformName, item.arch, release.version);
        actions.appendChild(link);
      });
    });
  }

  function createLogEntry(release) {
    var article = document.createElement('article');
    article.className = 'log-entry';

    var meta = document.createElement('div');
    meta.className = 'log-entry-meta';

    var label = document.createElement('span');
    label.className = 'log-entry-label';
    label.textContent = release.channel === 'stable' ? '正式版本' : release.channel;

    var version = document.createElement('div');
    version.className = 'log-entry__version';
    version.textContent = 'v' + release.version;

    var date = document.createElement('div');
    date.className = 'log-entry__date';
    date.textContent = release.date;

    var download = document.createElement('a');
    download.className = 'log-entry-download';
    // 直接使用 Cloudflare 的简洁路由，避免 .html 重定向时丢失指定版本参数。
    download.href = '/download?version=' + encodeURIComponent(release.version);
    download.textContent = '下载此版本';

    meta.append(label, version, date, download);

    var content = document.createElement('div');
    content.className = 'log-entry-content';

    var heading = document.createElement('div');
    heading.className = 'log-entry-heading';

    var releaseName = document.createElement('span');
    releaseName.textContent = 'Release ' + release.version;

    var title = document.createElement('div');
    title.className = 'log-entry__title';
    title.textContent = release.title;
    heading.append(releaseName, title);

    var list = document.createElement('ul');
    list.className = 'log-entry__list';
    release.content.forEach(function (text) {
      var item = document.createElement('li');
      var mark = document.createElement('span');
      mark.className = 'log-entry-mark';
      var copy = document.createElement('span');
      copy.textContent = text;
      item.append(mark, copy);
      list.appendChild(item);
    });

    content.append(heading, list);
    article.append(meta, content);
    return article;
  }

  function renderChangelogPage(manifest, latestRelease) {
    var timeline = document.querySelector('[data-release-timeline]');
    if (!timeline) return;

    document.querySelector('[data-release-summary-version]').textContent = 'v' + latestRelease.version;
    document.querySelector('[data-release-summary-date]').textContent = latestRelease.date;
    document.querySelector('[data-release-summary-count]').textContent = latestRelease.content.length + ' 项更新';
    timeline.replaceChildren();

    manifest.releases.forEach(function (release) {
      timeline.appendChild(createLogEntry(release));
    });
  }

  function showLoadError(message) {
    var timeline = document.querySelector('[data-release-timeline]');
    if (timeline) timeline.textContent = message;

    document.querySelectorAll('[data-platform-version]').forEach(function (element) {
      element.textContent = message;
    });
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('读取版本信息失败（' + response.status + '）');
      return response.json();
    });
  }

  fetch(manifestUrl)
    .then(function (manifest) {
      var latestRelease = validateManifest(manifest);
      var requestedVersion = new URLSearchParams(window.location.search).get('version');

      // changelog 页需要完整历史；下载页指定了历史版本时也需要历史数据。
      var needsHistory = Boolean(document.querySelector('[data-release-timeline]')) ||
        (requestedVersion && requestedVersion !== manifest.latest);
      if (!needsHistory) {
        return render(manifest, latestRelease);
      }

      return fetchJson(historyUrl).then(function (history) {
        if (!history || !Array.isArray(history.releases)) {
          throw new Error('版本历史格式不正确');
        }
        return render(history, latestRelease);
      });
    })
    .catch(function (error) {
      showLoadError(error instanceof Error ? error.message : '读取版本信息失败');
    });

  function render(manifest, latestRelease) {
    var downloadRelease = selectDownloadRelease(manifest, latestRelease);
    setLatestVersion(downloadRelease.version);
    renderDownloadPage(downloadRelease);
    renderChangelogPage(manifest, latestRelease);
  }
})();
