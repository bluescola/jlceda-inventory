import type {
	IFrameProductDetailsRequest,
	IFrameProductDetailsResult,
	IFrameProductDetailsStage,
} from '../../presentation/iframe-product-details-protocol';
import {
	parseIFrameProductDetailsRequest,
	PRODUCT_DETAILS_IFRAME_ID,
	PRODUCT_DETAILS_PROTOCOL_VERSION,
	PRODUCT_DETAILS_REQUEST_KEY,
	PRODUCT_DETAILS_RESULT_KEY,
} from '../../presentation/iframe-product-details-protocol';

interface ProductDetailsFormElements {
	shell: HTMLElement;
	bootStatus: HTMLElement;
	bootMessage: HTMLElement;
	form: HTMLFormElement;
	error: HTMLElement;
	connectionError: HTMLElement;
	partNumber: HTMLInputElement;
	name: HTMLInputElement;
	manufacturer: HTMLInputElement;
	manufacturerPartNumber: HTMLInputElement;
	package: HTMLInputElement;
	description: HTMLTextAreaElement;
	cancel: HTMLButtonElement;
	confirm: HTMLButtonElement;
}

void bootstrap();

async function bootstrap(): Promise<void> {
	let elements: ProductDetailsFormElements | undefined;
	try {
		elements = getElements();
		await initialize(elements);
	}
	catch (error) {
		showBootstrapError(elements, diagnosticErrorMessage(error));
	}
}

async function initialize(elements: ProductDetailsFormElements): Promise<void> {
	let request: IFrameProductDetailsRequest | undefined;
	try {
		request = parseIFrameProductDetailsRequest(
			eda.sys_Storage.getExtensionUserConfig(PRODUCT_DETAILS_REQUEST_KEY),
		);
	}
	catch {
		request = undefined;
	}
	if (!request) {
		showConnectionError(elements, connectionErrorMessage());
		return;
	}

	elements.bootMessage.textContent = request.labels.loading;
	const writeResult = async (result: IFrameProductDetailsResult): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(PRODUCT_DETAILS_RESULT_KEY, result);
		}
		catch {
			return false;
		}
	};
	let stage: IFrameProductDetailsStage = 'script-started';
	try {
		await requireBridgeWrite(writeResult, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'progress',
			stage,
		});
		stage = 'request-read';
		await requireBridgeWrite(writeResult, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'progress',
			stage,
		});
		renderForm(elements, request, writeResult);
		stage = 'form-rendered';
		await requireBridgeWrite(writeResult, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'progress',
			stage,
		});
		await requireBridgeWrite(writeResult, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
	}
	catch (error) {
		showConnectionError(elements, request.labels.connectionError);
		await writeResult({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage,
			errorName: diagnosticErrorName(error),
			error: diagnosticErrorMessage(error),
		});
	}
}

function renderForm(
	elements: ProductDetailsFormElements,
	request: IFrameProductDetailsRequest,
	writeResult: (result: IFrameProductDetailsResult) => Promise<boolean>,
): void {
	document.title = request.labels.title;
	document.documentElement.lang = inferLanguage(request.labels.confirm);
	setText('label-lcsc', request.labels.lcsc);
	setText('label-name', request.labels.name);
	setText('label-manufacturer', request.labels.manufacturer);
	setText('label-manufacturer-part-number', request.labels.manufacturerPartNumber);
	setText('label-package', request.labels.package);
	setText('label-description', request.labels.description);
	elements.cancel.textContent = request.labels.cancel;
	elements.confirm.textContent = request.labels.confirm;
	elements.partNumber.value = request.partNumber;
	elements.name.value = request.initial.name;
	elements.manufacturer.value = request.initial.manufacturer;
	elements.manufacturerPartNumber.value = request.initial.manufacturerPartNumber;
	elements.package.value = request.initial.package;
	elements.description.value = request.initial.description;
	elements.bootStatus.hidden = true;
	elements.form.hidden = false;
	elements.shell.setAttribute('aria-busy', 'false');

	const setBusy = (busy: boolean): void => {
		elements.cancel.disabled = busy;
		elements.confirm.disabled = busy;
	};
	const finish = async (result: IFrameProductDetailsResult): Promise<void> => {
		setBusy(true);
		elements.error.hidden = true;
		if (!await writeResult(result)) {
			setBusy(false);
			elements.error.textContent = request.labels.saveError;
			elements.error.hidden = false;
			return;
		}
		await eda.sys_IFrame.closeIFrame(PRODUCT_DETAILS_IFRAME_ID);
	};

	elements.form.addEventListener('submit', (event) => {
		event.preventDefault();
		if (!elements.name.value.trim()) {
			elements.error.textContent = request.labels.nameRequired;
			elements.error.hidden = false;
			elements.name.focus();
			return;
		}
		void finish({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'submitted',
			value: {
				name: elements.name.value,
				manufacturer: elements.manufacturer.value,
				manufacturerPartNumber: elements.manufacturerPartNumber.value,
				package: elements.package.value,
				description: elements.description.value,
			},
		});
	});
	elements.cancel.addEventListener('click', () => {
		void finish({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'cancelled',
		});
	});
}

async function requireBridgeWrite(
	writeResult: (result: IFrameProductDetailsResult) => Promise<boolean>,
	result: IFrameProductDetailsResult,
): Promise<void> {
	if (!await writeResult(result)) {
		throw new Error('The host rejected an IFrame bridge write.');
	}
}

function getElements(): ProductDetailsFormElements {
	return {
		shell: getElement('form-shell'),
		bootStatus: getElement('boot-status'),
		bootMessage: getElement('boot-message'),
		form: getElement('product-form'),
		error: getElement('form-error'),
		connectionError: getElement('connection-error'),
		partNumber: getElement('part-number'),
		name: getElement('name'),
		manufacturer: getElement('manufacturer'),
		manufacturerPartNumber: getElement('manufacturer-part-number'),
		package: getElement('package'),
		description: getElement('description'),
		cancel: getElement('cancel'),
		confirm: getElement('confirm'),
	};
}

function getElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing product form element: ${id}`);
	}
	return element as T;
}

function setText(id: string, value: string): void {
	getElement(id).textContent = value;
}

function showConnectionError(elements: ProductDetailsFormElements, message: string): void {
	elements.bootStatus.hidden = true;
	elements.form.hidden = true;
	elements.shell.setAttribute('aria-busy', 'false');
	elements.connectionError.textContent = message;
	elements.connectionError.hidden = false;
}

function showBootstrapError(elements: ProductDetailsFormElements | undefined, detail: string): void {
	const message = `${connectionErrorMessage()} ${detail}`.trim();
	if (elements) {
		showConnectionError(elements, message);
		return;
	}
	document.body.textContent = message;
	document.body.setAttribute('role', 'alert');
}

function inferLanguage(confirmLabel: string): string {
	return /[\u3400-\u9FFF]/.test(confirmLabel) ? 'zh-Hans' : 'en';
}

function connectionErrorMessage(): string {
	try {
		return eda.sys_I18n.text('productForm.connectionError');
	}
	catch {
		return 'The form connection failed.';
	}
}

function diagnosticErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message.slice(0, 300);
	}
	if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
		return error.message.slice(0, 300);
	}
	return String(error).slice(0, 300);
}

function diagnosticErrorName(error: unknown): string {
	if (error instanceof Error) {
		return error.name;
	}
	if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
		return error.name.slice(0, 80);
	}
	return typeof error;
}
