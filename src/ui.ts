import { copySlicerState, type SlicerState } from './slicer';
import type { SolidKind } from './solids';

type UiOptions = {
  state: SlicerState;
  onStateChange: () => void;
  onSolidChange: (solidKind: SolidKind) => void;
  onInnerSolidChange: (solidKind: SolidKind | null) => void;
  onOpenPresentationWindow: () => void;
  onClearVertexSelection: () => void;
  onReset: () => void;
  onToggleTransparent: (enabled: boolean) => void;
  onTogglePlaneVisible: (visible: boolean) => void;
  onScreenshot: () => void;
};

export type UiController = {
  setState: (nextState: SlicerState) => void;
  syncFromState: () => void;
  updateSelectedPoints: (labels: string[], message: string) => void;
};

type SliderKey = 'offset' | 'rotationX' | 'rotationY' | 'rotationZ';

const sliderConfig: Array<{
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  { key: 'offset', label: '切断位置', min: -3.5, max: 3.5, step: 0.01, unit: '' },
  { key: 'rotationX', label: 'X軸回転', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'rotationY', label: 'Y軸回転', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'rotationZ', label: 'Z軸回転', min: -180, max: 180, step: 1, unit: '°' },
];

const solidOptions: Array<{ value: SolidKind; label: string }> = [
  { value: 'cube', label: '立方体' },
  { value: 'box', label: '直方体' },
  { value: 'cylinder', label: '円柱' },
  { value: 'cone', label: '円錐' },
  { value: 'sphere', label: '球' },
];

export function createUi(container: HTMLElement, options: UiOptions): UiController {
  const state = options.state;

  container.innerHTML = `
    <label class="field">
      <span>外側の立体</span>
      <select id="solid-select" aria-label="表示する立体">
        ${solidOptions.map((solid) => `<option value="${solid.value}">${solid.label}</option>`).join('')}
      </select>
    </label>
    <div class="nested-field">
      <label class="inline-toggle"><input id="inner-solid-toggle" type="checkbox" /> 内側に図形を入れる</label>
      <label class="field">
        <span>内側の立体</span>
        <select id="inner-solid-select" aria-label="内側の立体" disabled>
          ${solidOptions.map((solid) => `<option value="${solid.value}">${solid.label}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="slider-list">
      ${sliderConfig
        .map(
          (slider) => `
            <label class="slider-field" for="${slider.key}">
              <span class="slider-label">
                <span>${slider.label}</span>
                <output id="${slider.key}-value"></output>
              </span>
              <input
                id="${slider.key}"
                type="range"
                min="${slider.min}"
                max="${slider.max}"
                step="${slider.step}"
                value="${state[slider.key]}"
              />
            </label>
          `,
        )
        .join('')}
    </div>
    <div class="point-selection">
      <div class="point-selection-header">
        <span>選択した点</span>
        <span id="selected-point-count">0 / 4</span>
      </div>
      <ol id="selected-point-list" class="selected-point-list">
        <li>点を4つ選んでください</li>
      </ol>
      <p id="selected-point-message" class="selected-point-message">3点で仮の切断面、4点で確定します。</p>
      <button id="clear-selection-button" type="button">点の選択をクリア</button>
    </div>
    <div class="toggle-list">
      <label class="field">
        <span>消す側</span>
        <select id="clip-side-select" aria-label="切ったときに消す側">
          <option value="1">平面の裏側を消す</option>
          <option value="-1">平面の表側を消す</option>
        </select>
      </label>
      <label><input id="transparent-toggle" type="checkbox" /> 半透明表示</label>
      <label><input id="plane-toggle" type="checkbox" checked /> 切断平面を表示</label>
    </div>
    <div class="button-row">
      <button id="reset-button" type="button">リセット</button>
      <button id="presentation-button" type="button">プレゼン用ウィンドウを開く</button>
      <button id="screenshot-button" type="button">スクリーンショット保存</button>
    </div>
  `;

  const solidSelect = container.querySelector<HTMLSelectElement>('#solid-select');
  const innerSolidToggle = container.querySelector<HTMLInputElement>('#inner-solid-toggle');
  const innerSolidSelect = container.querySelector<HTMLSelectElement>('#inner-solid-select');
  const clipSideSelect = container.querySelector<HTMLSelectElement>('#clip-side-select');
  const transparentToggle = container.querySelector<HTMLInputElement>('#transparent-toggle');
  const planeToggle = container.querySelector<HTMLInputElement>('#plane-toggle');
  const resetButton = container.querySelector<HTMLButtonElement>('#reset-button');
  const presentationButton = container.querySelector<HTMLButtonElement>('#presentation-button');
  const screenshotButton = container.querySelector<HTMLButtonElement>('#screenshot-button');
  const clearSelectionButton = container.querySelector<HTMLButtonElement>('#clear-selection-button');
  const selectedPointCount = container.querySelector<HTMLElement>('#selected-point-count');
  const selectedPointList = container.querySelector<HTMLOListElement>('#selected-point-list');
  const selectedPointMessage = container.querySelector<HTMLElement>('#selected-point-message');

  if (
    !solidSelect ||
    !innerSolidToggle ||
    !innerSolidSelect ||
    !clipSideSelect ||
    !transparentToggle ||
    !planeToggle ||
    !resetButton ||
    !presentationButton ||
    !screenshotButton ||
    !clearSelectionButton ||
    !selectedPointCount ||
    !selectedPointList ||
    !selectedPointMessage
  ) {
    throw new Error('UIの初期化に失敗しました');
  }

  const updateSliderOutputs = () => {
    for (const slider of sliderConfig) {
      const output = container.querySelector<HTMLOutputElement>(`#${slider.key}-value`);
      const input = container.querySelector<HTMLInputElement>(`#${slider.key}`);
      if (output && input) {
        input.value = String(state[slider.key]);
        output.textContent = `${Number(state[slider.key]).toFixed(slider.key === 'offset' ? 2 : 0)}${slider.unit}`;
      }
    }
  };

  const updateClipSideSelect = () => {
    clipSideSelect.value = String(state.clipSide);
  };

  for (const slider of sliderConfig) {
    const input = container.querySelector<HTMLInputElement>(`#${slider.key}`);
    input?.addEventListener('input', () => {
      state[slider.key] = Number(input.value);
      updateSliderOutputs();
      options.onStateChange();
    });
  }

  solidSelect.addEventListener('change', () => {
    options.onSolidChange(solidSelect.value as SolidKind);
  });

  const updateInnerSolid = () => {
    innerSolidSelect.disabled = !innerSolidToggle.checked;
    options.onInnerSolidChange(innerSolidToggle.checked ? (innerSolidSelect.value as SolidKind) : null);
  };

  innerSolidToggle.addEventListener('change', updateInnerSolid);
  innerSolidSelect.addEventListener('change', updateInnerSolid);

  clipSideSelect.addEventListener('change', () => {
    state.clipSide = Number(clipSideSelect.value) === -1 ? -1 : 1;
    options.onStateChange();
  });

  transparentToggle.addEventListener('change', () => {
    options.onToggleTransparent(transparentToggle.checked);
  });

  planeToggle.addEventListener('change', () => {
    options.onTogglePlaneVisible(planeToggle.checked);
  });

  clearSelectionButton.addEventListener('click', () => {
    options.onClearVertexSelection();
  });

  resetButton.addEventListener('click', () => {
    options.onReset();
  });

  presentationButton.addEventListener('click', () => {
    options.onOpenPresentationWindow();
  });

  screenshotButton.addEventListener('click', () => {
    options.onScreenshot();
  });

  updateSliderOutputs();
  updateClipSideSelect();

  return {
    setState(nextState: SlicerState) {
      copySlicerState(state, nextState);
      updateSliderOutputs();
      updateClipSideSelect();
      options.onStateChange();
    },
    syncFromState() {
      updateSliderOutputs();
      updateClipSideSelect();
    },
    updateSelectedPoints(labels: string[], message: string) {
      selectedPointCount.textContent = `${labels.length} / 4`;
      selectedPointList.innerHTML =
        labels.length > 0
          ? labels.map((label) => `<li>${label}</li>`).join('')
          : '<li>点を4つ選んでください</li>';
      selectedPointMessage.textContent = message;
    },
  };
}
