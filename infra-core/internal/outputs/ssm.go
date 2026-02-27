package outputs

import "iac-core/internal/config"

type CoreSSM struct {
	AppName string
	Stage   string
}

func NewCoreSSM(core config.CoreConfig) CoreSSM {
	return CoreSSM{AppName: core.AppName, Stage: core.Stage}
}

func (p CoreSSM) VpcId() string {
	return "/" + p.AppName + "/" + p.Stage + "/vpc/id"
}

func (p CoreSSM) PrivateSubnetIds() string {
	return "/" + p.AppName + "/" + p.Stage + "/vpc/subnets/private"
}

func (p CoreSSM) PublicSubnetIds() string {
	return "/" + p.AppName + "/" + p.Stage + "/vpc/subnets/public"
}

func (p CoreSSM) IsolatedSubnetIds() string {
	return "/" + p.AppName + "/" + p.Stage + "/vpc/subnets/isolated"
}

func (p CoreSSM) AvailabilityZones() string {
	return "/" + p.AppName + "/" + p.Stage + "/vpc/azs"
}

func (p CoreSSM) ClusterArn() string {
	return "/" + p.AppName + "/" + p.Stage + "/ecs/cluster/arn"
}

func (p CoreSSM) ClusterName() string {
	return "/" + p.AppName + "/" + p.Stage + "/ecs/cluster/name"
}

func (p CoreSSM) AlbArn() string {
	return "/" + p.AppName + "/" + p.Stage + "/alb/arn"
}

func (p CoreSSM) AlbHttpsListenerArn() string {
	return "/" + p.AppName + "/" + p.Stage + "/alb/listener/https/arn"
}

func (p CoreSSM) ServiceDiscoveryNamespaceName() string {
	return "/" + p.AppName + "/" + p.Stage + "/sd/namespace/name"
}

func (p CoreSSM) ServiceDiscoveryNamespaceId() string {
	return "/" + p.AppName + "/" + p.Stage + "/sd/namespace/id"
}

func (p CoreSSM) AlbCertArn() string {
	return "/" + p.AppName + "/" + p.Stage + "/alb/cert/arn"
}

func (p CoreSSM) GitHubActionsRoleArn() string {
	return "/" + p.AppName + "/" + p.Stage + "/oidc/github/role/arn"
}
