/* global React */
import {sfConn} from "./inspector.js";

const h = React.createElement;

export function SfHomeLink({sfHost, target}) {
  return h("a", {href: "https://" + sfHost, target, className: "sf-link"},
    h("svg", {viewBox: "0 0 24 24"},
      h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
    ),
    " Salesforce Home"
  );
}

export function Spinner({hidden}) {
  return h("div", {id: "spinner", role: "status", className: "slds-spinner slds-spinner_small slds-spinner_inline", hidden},
    h("span", {className: "slds-assistive-text"}),
    h("div", {className: "slds-spinner__dot-a"}),
    h("div", {className: "slds-spinner__dot-b"}),
  );
}

/**
 * Top bar of a tool page: Salesforce Home link, page title, current user, spinner, Options and Help buttons.
 * - options: omitted/false = no Options button, true = Options page, number = Options page opened on that tab
 * - help: {title, onClick} to toggle an in-page help, or {title, href} to open an external help page
 * - spinner: false to not render the spinner at all
 * - children: extra elements shown before the spinner
 */
export class PageHeader extends React.Component {
  constructor(props) {
    super(props);
    this.state = {userInfo: "...", loadingUserInfo: true};
  }
  componentDidMount() {
    sfConn.getUserInfo()
      .then(res => this.setState({userInfo: res.userFullName + " / " + res.userName + " / " + res.organizationName}))
      .catch(err => console.error("Failed to load user info", err))
      .finally(() => this.setState({loadingUserInfo: false}));
  }
  render() {
    let {sfHost, title, spinning, spinner = true, options, help} = this.props;
    let {userInfo, loadingUserInfo} = this.state;
    let optionsArgs = new URLSearchParams();
    optionsArgs.set("host", sfHost);
    if (typeof options == "number") {
      optionsArgs.set("tab", options);
    }
    return h("div", {id: "user-info"},
      h(SfHomeLink, {sfHost}),
      h("h1", {}, title),
      h("span", {}, " / " + userInfo),
      h("div", {className: "flex-right"},
        spinner ? h(Spinner, {hidden: !spinning && !loadingUserInfo}) : null,
        options ? h("a", {href: "options.html?" + optionsArgs, className: "top-btn", id: "options-btn", title: "Option", target: "_blank"},
          h("div", {className: "icon"})
        ) : null,
        help ? h("a", {href: help.href || "#", target: help.href ? "_blank" : undefined, className: "top-btn", id: "help-btn", title: help.title, onClick: help.onClick},
          h("div", {className: "icon"})
        ) : null,
      ),
    );
  }
}
