import {
  ReduxAction,
  ReduxActionErrorTypes,
  ReduxActionTypes,
} from "../constants/ReduxActionConstants";
import { Intent } from "@blueprintjs/core";
import {
  all,
  call,
  select,
  put,
  takeEvery,
  takeLatest,
} from "redux-saga/effects";
import { ActionPayload, PageAction } from "../constants/ActionConstants";
import ActionAPI, {
  ActionCreateUpdateResponse,
  ExecuteActionRequest,
  RestAction,
  ActionApiResponse,
} from "../api/ActionAPI";
import { AppState, DataTree } from "../reducers";
import _ from "lodash";
import { mapToPropList } from "../utils/AppsmithUtils";
import AppToaster from "../components/editorComponents/ToastComponent";
import { GenericApiResponse } from "../api/ApiResponses";
import {
  createActionSuccess,
  deleteActionSuccess,
  updateActionSuccess,
} from "../actions/actionActions";
import { API_EDITOR_ID_URL, API_EDITOR_URL } from "../constants/routes";
import { getDynamicBoundValue } from "../utils/DynamicBindingUtils";
import history from "../utils/history";
import { createUpdateBindingsMap } from "../actions/bindingActions";
/* eslint-disable no-use-before-define */

const getDataTree = (state: AppState): DataTree => {
  return state.entities;
};

const getAction = (
  state: AppState,
  actionId: string,
): RestAction | undefined => {
  return _.find(state.entities.actions.data, { id: actionId });
};

export function* evaluateJSONPathSaga(path: string): any {
  const dataTree = yield select(getDataTree);
  return getDynamicBoundValue(dataTree, path);
}

export function* executeAPIQueryActionSaga(apiAction: ActionPayload) {
  const api: PageAction = yield select(getAction, apiAction.actionId);

  const executeActionRequest: ExecuteActionRequest = {
    actionId: apiAction.actionId,
  };
  if (!_.isNil(api.jsonPathKeys)) {
    const values: any = _.flatten(
      yield all(
        api.jsonPathKeys.map((jsonPath: string) => {
          return call(evaluateJSONPathSaga, jsonPath);
        }),
      ),
    );
    const dynamicBindings: Record<string, string> = {};
    api.jsonPathKeys.forEach((key, i) => {
      dynamicBindings[key] = values[i];
    });
    executeActionRequest.params = mapToPropList(dynamicBindings);
  }
  const response: ActionApiResponse = yield ActionAPI.executeAction(
    executeActionRequest,
  );
  let payload = response;
  if (response.responseMeta && response.responseMeta.error) {
    payload = {
      body: response.responseMeta.error,
      statusCode: response.responseMeta.error.code,
      ...response,
    };
    if (apiAction.onError) {
      yield put({
        type: ReduxActionTypes.EXECUTE_ACTION,
        payload: apiAction.onError,
      });
    }
    yield put({
      type: ReduxActionTypes.EXECUTE_ACTION_ERROR,
      payload: { [apiAction.actionId]: payload },
    });
  } else {
    if (apiAction.onSuccess) {
      yield put({
        type: ReduxActionTypes.EXECUTE_ACTION,
        payload: apiAction.onSuccess,
      });
    }
    yield put({
      type: ReduxActionTypes.EXECUTE_ACTION_SUCCESS,
      payload: { [apiAction.actionId]: payload },
    });
  }
  return response;
}

// TODO(satbir): Refact this to not make this recursive.
export function* executeActionSaga(actionPayloads: ActionPayload[]): any {
  yield all(
    _.map(actionPayloads, (actionPayload: ActionPayload) => {
      switch (actionPayload.actionType) {
        case "API":
          return call(executeAPIQueryActionSaga, actionPayload);
        case "QUERY":
          return call(executeAPIQueryActionSaga, actionPayload);
        default:
          return undefined;
      }
    }),
  );
}

export function* executeReduxActionSaga(action: ReduxAction<ActionPayload[]>) {
  if (!_.isNil(action.payload)) {
    yield call(executeActionSaga, action.payload);
  }
}

export function* createActionSaga(actionPayload: ReduxAction<RestAction>) {
  const response: ActionCreateUpdateResponse = yield ActionAPI.createAPI(
    actionPayload.payload,
  );
  if (response.responseMeta.success) {
    AppToaster.show({
      message: `${actionPayload.payload.name} Action created`,
      intent: Intent.SUCCESS,
    });
    yield put(createActionSuccess(response.data));
    yield put(createUpdateBindingsMap());
    history.push(API_EDITOR_ID_URL(response.data.id));
  }
}

export function* fetchActionsSaga() {
  const response: GenericApiResponse<
    RestAction[]
  > = yield ActionAPI.fetchActions();
  if (response.responseMeta.success) {
    yield put({
      type: ReduxActionTypes.FETCH_ACTIONS_SUCCESS,
      payload: response.data,
    });
  } else {
    yield put({
      type: ReduxActionErrorTypes.FETCH_ACTIONS_ERROR,
      payload: response.responseMeta.status,
    });
  }
}

export function* updateActionSaga(
  actionPayload: ReduxAction<{ data: RestAction }>,
) {
  const response: GenericApiResponse<RestAction> = yield ActionAPI.updateAPI(
    actionPayload.payload.data,
  );
  if (response.responseMeta.success) {
    AppToaster.show({
      message: `${actionPayload.payload.data.name} Action updated`,
      intent: Intent.SUCCESS,
    });
    yield put(updateActionSuccess({ data: response.data }));
    yield put(createUpdateBindingsMap());
  } else {
    AppToaster.show({
      message: "Error occurred when updating action",
      intent: Intent.DANGER,
    });
  }
}

export function* deleteActionSaga(actionPayload: ReduxAction<{ id: string }>) {
  const id = actionPayload.payload.id;
  const response: GenericApiResponse<RestAction> = yield ActionAPI.deleteAction(
    id,
  );
  if (response.responseMeta.success) {
    AppToaster.show({
      message: `${response.data.name} Action deleted`,
      intent: Intent.SUCCESS,
    });
    yield put(deleteActionSuccess({ id }));
    yield put(createUpdateBindingsMap());
    history.push(API_EDITOR_URL);
  } else {
    AppToaster.show({
      message: "Error occurred when deleting action",
      intent: Intent.DANGER,
    });
  }
}

export function* watchActionSagas() {
  yield all([
    takeEvery(ReduxActionTypes.FETCH_ACTIONS_INIT, fetchActionsSaga),
    takeLatest(ReduxActionTypes.EXECUTE_ACTION, executeReduxActionSaga),
    takeLatest(ReduxActionTypes.CREATE_ACTION_INIT, createActionSaga),
    takeLatest(ReduxActionTypes.UPDATE_ACTION_INIT, updateActionSaga),
    takeLatest(ReduxActionTypes.DELETE_ACTION_INIT, deleteActionSaga),
  ]);
}
